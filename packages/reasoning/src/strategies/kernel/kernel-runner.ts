/**
 * shared/kernel-runner.ts — Universal execution loop for all reasoning strategies.
 *
 * Replaces the duplicated while-loops in reactive.ts and react-kernel.ts with a
 * single `runKernel()` function. Every strategy defines a `ThoughtKernel` (one step
 * of reasoning) and hands it to `runKernel()` which handles:
 *
 *   1. Service resolution (LLM, ToolService, EventBus via Effect.serviceOption)
 *   2. Profile merging (input.contextProfile over CONTEXT_PROFILES["mid"])
 *   3. KernelHooks construction from EventBus
 *   4. Immutable KernelContext assembly (frozen for entire execution)
 *   5. Main loop: call kernel repeatedly until done/failed/maxIterations
 *   6. Terminal hooks: onDone / onError
 */
import { Effect } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService, DEFAULT_CAPABILITIES, selectAdapter } from "@reactive-agents/llm-provider";
import type { ProviderCapabilities } from "@reactive-agents/llm-provider";
import { createToolCallResolver } from "@reactive-agents/tools";
import { checkpointStoreRef } from "@reactive-agents/tools";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { resolveStrategyServices } from "./utils/service-utils.js";
import { buildKernelHooks } from "./kernel-hooks.js";
import { makeStep } from "./utils/step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
} from "./kernel-state.js";
import { evaluateStrategySwitch, buildHandoff } from "./utils/strategy-evaluator.js";
import { coordinateICS } from "./utils/ics-coordinator.js";
import { runReactiveObserver } from "./utils/reactive-observer.js";
import { detectLoop, checkAllToolsCalled } from "./utils/loop-detector.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsByCount,
  getEffectiveMissingRequiredTools,
} from "./utils/requirement-state.js";
import {
  decideExecutionLane,
  shouldInjectOracleNudge,
} from "./utils/lane-controller.js";
import { extractOutputFormat, type TaskIntent } from "./utils/task-intent.js";
import { shouldAutoCheckpoint, autoCheckpoint } from "./utils/auto-checkpoint.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildFinalAnswerCandidate,
  finalizeOutput,
  buildSynthesisPrompt,
  type FinalizedOutput,
} from "./utils/output-synthesis.js";

import { META_TOOLS as RUNNER_META_TOOLS } from "./kernel-constants.js";

/** Keys embedded in compressed tool observations (`[STORED: _tool_result_N | tool]`) */
const STORED_TOOL_KEY_RE = /\[STORED:\s*(_tool_result_\d+)\s*\|/g;
/** Keys referenced by compression hints (e.g. `recall("_tool_result_5", ...)`). */
const RECALL_TOOL_KEY_RE = /recall\("(_tool_result_\d+)"/g;

function missingRequiredToolsForInput(
  steps: KernelState["steps"],
  input: KernelInput,
): readonly string[] {
  return getEffectiveMissingRequiredTools(
    steps,
    input.requiredTools ?? [],
    input.requiredToolQuantities,
  );
}

/**
 * When an observation is a compressed preview, replace it with full text from the kernel
 * scratchpad so harness / output-gate paths do not hallucinate from ASCII banners only.
 */
function resolveStoredToolObservation(
  content: string,
  scratchpad: ReadonlyMap<string, string>,
  preferredKey?: string,
): string {
  const keys = [...new Set([
    ...(preferredKey ? [preferredKey] : []),
    ...[...content.matchAll(STORED_TOOL_KEY_RE)].map((m) => m[1]!),
    ...[...content.matchAll(RECALL_TOOL_KEY_RE)].map((m) => m[1]!),
  ])];
  if (keys.length === 0) return content;
  const payloads = keys
    .map((k) => scratchpad.get(k))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (payloads.length === 0) return content;
  return payloads.join("\n\n---\n\n");
}

// ── Harness deliverable assembly ──────────────────────────────────────────────

/**
 * Assemble a deliverable from accumulated tool results.
 *
 * When the harness determines the model is spinning but has already gathered
 * useful data, this function extracts all successful non-meta tool observations
 * and joins them as the final output. The harness owns task completion —
 * it doesn't depend on the model calling `final-answer`.
 *
 * Filters out guard-blocked observations (which are marked success=true but
 * contain warning markers) by requiring the tool to be in `state.toolsUsed`
 * (only actually-executed tools are added to that set) and excluding known
 * guard-block text patterns.
 */
export function assembleDeliverable(state: KernelState): string {
  const artifacts = collectDeliverableArtifacts(state);
  if (artifacts.length > 0) return artifacts.join("\n\n");

  // Fallback: use the last substantive thought
  const lastThought = [...state.steps]
    .reverse()
    .find((s) => s.type === "thought" && (s.content ?? "").length > 20);
  return lastThought?.content ?? "Task complete.";
}

function collectDeliverableArtifacts(state: KernelState): string[] {
  const artifacts: string[] = [];
  for (const step of state.steps) {
    const content = getDeliverableObservationContent(state, step);
    if (content) artifacts.push(content);
  }

  return artifacts;
}

function countDeliverableCandidates(state: KernelState): number {
  let count = 0;
  for (const step of state.steps) {
    if (getDeliverableObservationContent(state, step) !== null) count++;
  }

  return count;
}

function getDeliverableObservationContent(
  state: KernelState,
  step: KernelState["steps"][number],
): string | null {
  if (step.type !== "observation") return null;

  const raw = (step.content ?? "").trim();
  if (raw.length === 0) return null;
  if (raw.startsWith("\u26A0\uFE0F") || raw.includes("[Already done")) return null;

  const observationResult = step.metadata?.observationResult as
    | { success?: boolean; toolName?: string }
    | undefined;

  if (observationResult) {
    if (observationResult.success !== true) return null;
    if (observationResult.toolName && RUNNER_META_TOOLS.has(observationResult.toolName)) return null;
    if (observationResult.toolName && !state.toolsUsed.has(observationResult.toolName)) return null;
  } else {
    const hasRealUsedTool = [...state.toolsUsed].some((toolName) => !RUNNER_META_TOOLS.has(toolName));
    if (!hasRealUsedTool) return null;
  }

  const storedKey = typeof step.metadata?.storedKey === "string" ? step.metadata.storedKey : undefined;
  return resolveStoredToolObservation(raw, state.scratchpad, storedKey);
}

function buildEffectiveToolsUsed(state: KernelState): Set<string> {
  const effective = new Set(state.toolsUsed);
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const observationResult = step.metadata?.observationResult as {
      success?: boolean;
      delegatedToolsUsed?: readonly string[];
    } | undefined;
    if (observationResult?.success !== true || !Array.isArray(observationResult.delegatedToolsUsed)) continue;
    for (const toolName of observationResult.delegatedToolsUsed) {
      if (typeof toolName === "string" && toolName.length > 0) {
        effective.add(toolName);
      }
    }
  }
  return effective;
}

// ── Tier-aware guard thresholds ───────────────────────────────────────────────

/** Per-tier thresholds for kernel guards. */
export interface TierGuardConfig {
  /** Token delta below which an iteration is considered "low progress". */
  readonly tokenDeltaThreshold: number;
  /** Default max same-tool calls before loop detection fires. */
  readonly maxSameToolDefault: number;
  /** Number of ignored oracle nudges before force-exit. */
  readonly oracleNudgeLimit: number;
}

/** Tier-specific guard thresholds — local is strict, frontier is lenient. */
export const TIER_GUARD_THRESHOLDS: Record<string, TierGuardConfig> = {
  local:    { tokenDeltaThreshold: 300,  maxSameToolDefault: 2, oracleNudgeLimit: 1 },
  mid:      { tokenDeltaThreshold: 500,  maxSameToolDefault: 3, oracleNudgeLimit: 2 },
  large:    { tokenDeltaThreshold: 700,  maxSameToolDefault: 4, oracleNudgeLimit: 3 },
  frontier: { tokenDeltaThreshold: 1000, maxSameToolDefault: 5, oracleNudgeLimit: 3 },
};

// ── Token-delta guard ─────────────────────────────────────────────────────────

/**
 * Guard: exit when model stops making progress (2 consecutive low-delta iterations).
 *
 * Conditions that must ALL be true to trigger early exit:
 * - iteration >= 3 (give the model at least a few steps before judging)
 * - tokenDelta < threshold (tier-specific, defaults to mid=500)
 * - consecutiveLowDeltaCount >= 2 (two consecutive low-delta iterations in a row)
 */
export function shouldExitOnLowDelta(opts: {
  iteration: number
  tokenDelta: number
  consecutiveLowDeltaCount: number
  tier?: string
}): boolean {
  const { iteration, tokenDelta, consecutiveLowDeltaCount, tier } = opts
  const threshold = (TIER_GUARD_THRESHOLDS[tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).tokenDeltaThreshold;
  return iteration >= 3 && tokenDelta < threshold && consecutiveLowDeltaCount >= 2
}

// ── Oracle hard gate ──────────────────────────────────────────────────────────

/**
 * Guard: force exit when the pulse oracle has said readyToAnswer=true but the
 * model has ignored it for N consecutive iterations (tier-dependent).
 *
 * Stage 1 (nudgeCount < limit): caller should inject a mandatory steering nudge and
 * increment readyToAnswerNudgeCount.
 * Stage 2 (nudgeCount >= limit): return true → caller terminates with "oracle_forced".
 */
export function shouldForceOracleExit(opts: {
  oracleReady: boolean
  readyToAnswerNudgeCount: number
  tier?: string
}): boolean {
  const nudgeLimit = (TIER_GUARD_THRESHOLDS[opts.tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).oracleNudgeLimit;
  return opts.oracleReady && opts.readyToAnswerNudgeCount >= nudgeLimit
}

/**
 * Resolve the effective maxSameTool loop-detection window.
 *
 * In parallel mode, adaptive classification may require N calls of the same tool
 * (e.g. `web-search×4` for four entities). The loop detector fires when the last
 * `maxSameTool` actions all have identical content — if the window is smaller than N,
 * it can fire prematurely before the required quota is met.
 *
 * This function raises the base tier default to at least the highest required-tool
 * quantity, capped at 20 as a safety net against runaway same-tool loops.
 */
export function resolveMaxSameTool(
  baseMax: number,
  requiredToolQuantities?: Readonly<Record<string, number>>,
): number {
  if (!requiredToolQuantities) return baseMax;
  const values = Object.values(requiredToolQuantities);
  if (values.length === 0) return baseMax;
  const maxRequired = Math.max(...values);
  return Math.min(20, Math.max(baseMax, maxRequired));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the readyToAnswer flag from the most recent pulse observation step.
 * Returns false when there is no pulse observation or the JSON cannot be parsed.
 */
function getLastPulseReadyToAnswer(state: KernelState): boolean {
  const pulseObs = [...state.steps]
    .reverse()
    .find(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.toolName === "pulse",
    );
  if (!pulseObs) return false;
  try {
    const parsed = JSON.parse(pulseObs.content ?? "");
    return parsed?.readyToAnswer === true;
  } catch {
    return false;
  }
}

/** Error strings from recent failed tool observations — feeds ICS nudge content. */
function getLastErrors(state: KernelState): readonly string[] {
  return state.steps
    .filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    )
    .slice(-2)
    .map(
      (s) =>
        s.metadata?.observationResult?.displayText ||
        s.content ||
        "unknown error",
    )
}

type ToolFailureRecovery = {
  readonly failedUnresolved: readonly string[];
  readonly alternativeCandidates: readonly string[];
};

type RecoverySteeringKind = "stall" | "loop";

function buildRecoverySteeringGuidance(
  recovery: ToolFailureRecovery,
  failureRecoveryRedirects: number,
  maxFailureRecoveryRedirects: number,
  kind: RecoverySteeringKind,
): string {
  const nextPath =
    recovery.alternativeCandidates[0] ??
    recovery.failedUnresolved[0] ??
    "an available tool";
  const failedList = recovery.failedUnresolved.join(", ");
  const progress = `(${failureRecoveryRedirects}/${maxFailureRecoveryRedirects})`;

  if (recovery.alternativeCandidates.length > 0) {
    if (kind === "stall") {
      return (
        `Recovery required: prior tool path failed (${failedList}). Try an alternate path now: ${nextPath}. Do not finalize yet. ${progress}`
      );
    }
    return (
      `Recovery required: loop detected after failed tool path (${failedList}). Try alternate path ${nextPath} before completion. ${progress}`
    );
  }
  if (kind === "stall") {
    return (
      `Recovery required: prior tool path failed (${failedList}). Retry ${nextPath} with corrected arguments/evidence. Do not finalize yet. ${progress}`
    );
  }
  return (
    `Recovery required: loop detected after failed tool path (${failedList}). Retry ${nextPath} with corrected arguments before completion. ${progress}`
  );
}

/**
 * Identify whether failed tool paths still have viable alternatives.
 *
 * A tool is "failed unresolved" when we saw at least one failed observation and
 * no successful observation for that same tool yet.
 */
function getToolFailureRecovery(
  state: KernelState,
  input: KernelInput,
): ToolFailureRecovery {
  const successCounts = buildSuccessfulToolCallCounts(state.steps);
  const successful = new Set<string>(Object.keys(successCounts));
  const failed = new Set<string>();

  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as
      | { readonly success?: boolean; readonly toolName?: string }
      | undefined;
    const toolName = result?.toolName;
    if (!toolName || RUNNER_META_TOOLS.has(toolName)) continue;

    if (result.success === false && (successCounts[toolName] ?? 0) === 0) {
      failed.add(toolName);
    }
  }

  const required = input.requiredTools ?? [];
  const requiredStillNeeded = getEffectiveMissingRequiredTools(
    state.steps,
    required,
    input.requiredToolQuantities,
  );
  const relevant = input.relevantTools ?? [];
  const available = (input.availableToolSchemas ?? []).map((t) => t.name);

  const candidatePool = [...new Set([...requiredStillNeeded, ...required, ...relevant, ...available])]
    .filter((name) => !RUNNER_META_TOOLS.has(name));

  const failedUnresolved = [...failed].filter((name) => !successful.has(name));
  if (failedUnresolved.length === 0) {
    return { failedUnresolved: [], alternativeCandidates: [] };
  }

  const failedUnresolvedSet = new Set(failedUnresolved);
  const requiredStillNeededSet = new Set(requiredStillNeeded);
  const alternativeCandidates = candidatePool.filter((name) => {
    if (failedUnresolvedSet.has(name)) return false;
    return requiredStillNeededSet.has(name) || !successful.has(name);
  });

  return {
    failedUnresolved,
    alternativeCandidates,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a ThoughtKernel in a loop until it reaches "done", "failed", or
 * exhausts `maxIterations`.
 *
 * This is the **universal execution loop** — every reasoning strategy delegates
 * to this function instead of implementing its own while-loop.
 */
export function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // ── 1. Resolve services ──────────────────────────────────────────────────
    const services = yield* resolveStrategyServices;
    const { toolService, eventBus } = services;

    // ── Auto-inject ToolCallResolver ─────────────────────────────────────────
    // When the provider supports native FC, create a resolver and inject it
    // into the kernel input so handleThinking uses native function calling.
    let effectiveInput = input;
    if (!input.toolCallResolver) {
      const llmOpt = yield* Effect.serviceOption(LLMService);
      if (llmOpt._tag === "Some" && typeof llmOpt.value.capabilities === "function") {
        const caps = yield* llmOpt.value.capabilities().pipe(
          Effect.catchAll(() => Effect.succeed(DEFAULT_CAPABILITIES)),
        );
        if (caps.supportsToolCalling) {
          const resolver = createToolCallResolver(caps);
          effectiveInput = { ...input, toolCallResolver: resolver };
        }
      }
    }

    // ── 2. Build profile ─────────────────────────────────────────────────────
    // Ollama providers default to "local" tier (maxSameTool=2) unless an
    // explicit contextProfile.tier has been set by the caller.
    const defaultTier =
      effectiveInput.providerName === "ollama" && !effectiveInput.contextProfile?.tier
        ? "local"
        : "mid";
    const baseProfile: ContextProfile = effectiveInput.contextProfile
      ? ({ ...CONTEXT_PROFILES[defaultTier], ...effectiveInput.contextProfile } as ContextProfile)
      : CONTEXT_PROFILES[defaultTier];

    // ── Calibration-aware profile overrides ──────────────────────────────────
    // selectAdapter may return profileOverrides sourced from a ModelCalibration
    // (e.g., optimalToolResultChars). Apply these once up-front so every phase
    // sees calibrated values via KernelContext.profile.
    const { profileOverrides } = selectAdapter(
      { supportsToolCalling: true },
      baseProfile.tier,
      effectiveInput.modelId,
    );
    const profile: ContextProfile = profileOverrides
      ? ({ ...baseProfile, ...profileOverrides } as ContextProfile)
      : baseProfile;

    // ── 3. Build hooks ───────────────────────────────────────────────────────
    const hooks = buildKernelHooks(eventBus);

    // ── 4. Build KernelContext ────────────────────────────────────────────────
    const context: KernelContext = {
      input: effectiveInput,
      profile,
      compression: effectiveInput.resultCompression ?? {
        budget: profile.toolResultMaxChars ?? 800,
        previewItems: profile.toolResultPreviewItems ?? 5,
        autoStore: true,
        codeTransform: true,
      },
      toolService,
      hooks,
    };

    // ── 5. Extract task intent for output quality gate ─────────────────────
    const taskIntent = extractOutputFormat(effectiveInput.task);

    // ── 6. Create initial state ──────────────────────────────────────────────
    const baseState = initialKernelState(options);
    // Seed messages from input.initialMessages if provided (e.g. chat history injection)
    let state = effectiveInput.initialMessages?.length
      ? transitionState(baseState, { messages: effectiveInput.initialMessages })
      : baseState;

    // Mutable scratchpad mirror — synced from state.scratchpad (ReadonlyMap) after each kernel step.
    const mutableScratchpad = new Map<string, string>(state.scratchpad);

    // ── 7. Main loop ─────────────────────────────────────────────────────────
    // Track tool calls per iteration by scanning new action steps since last check.
    let prevActionCount = 0;
    let prevStepCount = 0;
    const loopCfg = options.loopDetection;
    const tierGuards = TIER_GUARD_THRESHOLDS[profile.tier] ?? TIER_GUARD_THRESHOLDS["mid"];
    const maxSameTool = resolveMaxSameTool(
      loopCfg?.maxSameToolCalls ?? tierGuards.maxSameToolDefault,
      effectiveInput.requiredToolQuantities,
    );
    const maxRepeatedThought = loopCfg?.maxRepeatedThoughts ?? 3;
    const maxConsecutiveThoughts = loopCfg?.maxConsecutiveThoughts ?? 3;

    // Required tools guard — tracks redirect attempts to prevent infinite loops
    const requiredTools = effectiveInput.requiredTools ?? [];
    const maxRequiredToolRetries = effectiveInput.maxRequiredToolRetries ?? 2;
    let requiredToolRedirects = 0;

    // Unified nudge budget — caps the total number of "missing required tool"
    // nudges injected by stall detection and loop detection paths combined.
    // Without this, the stall and loop paths can compound nudges indefinitely
    // when the model refuses to (or cannot) satisfy the required tool quota.
    let requiredToolNudgeCount = 0;
    const maxRequiredToolNudges = maxRequiredToolRetries + 2;

    // Required-tools availability guard (pre-loop)
    // If required tools are declared but not available in this run's tool schemas,
    // fail immediately instead of allowing synthesis/fallback to fabricate completion.
    if (requiredTools.length > 0) {
      const visibleTools = (effectiveInput.availableToolSchemas ?? []).map((t) => t.name);
      const allKnownTools = (effectiveInput.allToolSchemas ?? effectiveInput.availableToolSchemas ?? []).map((t) => t.name);
      const knownToolSet = new Set(allKnownTools);
      const unavailableRequired = requiredTools.filter((t) => !knownToolSet.has(t));
      if (allKnownTools.length > 0 && unavailableRequired.length > 0) {
        state = transitionState(state, {
          status: "failed",
          error:
            `Task incomplete — missing_required_tool: required tool(s) unavailable: ${unavailableRequired.join(", ")}.\n` +
            `required=[${requiredTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]`,
        });
      }
    }

    // Strategy switching state
    let switchCount = 0;
    const triedStrategies: string[] = [options.strategy ?? "reactive"];
    // currentOptions tracks the active strategy name for the current pass
    let currentOptions = options;
    // currentInput tracks per-pass input (may carry handoff priorContext)
    let currentInput: KernelInput = effectiveInput;
    // currentContext tracks the KernelContext (rebuilt when input changes on switch)

    let currentContext: KernelContext = context;

    // Harness stall tracking — counts consecutive iterations with no new non-meta tool results.
    // When the model has gathered artifacts but stalls, the harness delivers accumulated data.
    let consecutiveStalled = 0;
    let prevArtifactCount = 0;

    // Failure recovery redirects — when a tool path fails and alternatives exist,
    // force at least a small number of alternate attempts before harness delivery.
    let failureRecoveryRedirects = 0;
    const maxFailureRecoveryRedirects = Math.max(2, maxRequiredToolRetries);

    // Auto-checkpoint tracking — fires once when context pressure enters the soft zone.
    let autoCheckpointed = false;

    const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.serviceOption(ObservableLogger).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.emit(event).pipe(Effect.catchAll(() => Effect.void))
            : Effect.void
        )
      );

    while (
      state.status !== "done" &&
      state.status !== "failed" &&
      state.iteration < currentOptions.maxIterations &&
      (state.llmCalls ?? 0) < currentOptions.maxIterations
    ) {
      const prevTokens = state.tokens;

      yield* emitLog({
        _tag: "iteration",
        iteration: state.iteration,
        phase: "thought",
        timestamp: new Date(),
      });

      const kernelPhaseStart = Date.now();
      yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });
      state = yield* kernel(state, currentContext);
      yield* emitLog({
        _tag: "phase_complete",
        phase: "think",
        duration: Date.now() - kernelPhaseStart,
        status: state.status === "failed" ? "error" : "success",
      });

      // ── Token-delta diminishing-returns guard ────────────────────────────
      // Track consecutive iterations where the model adds fewer than the
      // tier-specific token threshold. After 2 such iterations (starting from
      // iteration 3), exit early to prevent wasted iterations on a stalled model.
      // Guard is skipped when no LLM calls have been made (e.g. test/mock kernels
      // that emit 0 tokens) to avoid false positives in non-LLM scenarios.
      const tokenDelta = state.tokens - prevTokens;
      if (state.tokens > 0 || prevTokens > 0) {
        const lowDelta = tokenDelta < tierGuards.tokenDeltaThreshold;
        const newConsecutiveLowDelta = lowDelta ? (state.consecutiveLowDeltaCount ?? 0) + 1 : 0;
        state = transitionState(state, { consecutiveLowDeltaCount: newConsecutiveLowDelta });

        // Only fire the guard when there are remaining iterations to save
        // (if we're already at the last iteration, the loop exits naturally).
        const hasRemainingIterations = state.iteration < currentOptions.maxIterations - 1;
        const missingRequiredForLowDelta = missingRequiredToolsForInput(state.steps, currentInput);
        if (
          hasRemainingIterations &&
          missingRequiredForLowDelta.length === 0 &&
          state.status !== "done" &&
          state.status !== "failed" &&
          shouldExitOnLowDelta({ iteration: state.iteration, tokenDelta, consecutiveLowDeltaCount: newConsecutiveLowDelta, tier: profile.tier })
        ) {
          yield* Effect.log(`[token-delta-guard] Early exit: 2 consecutive iterations with <${tierGuards.tokenDeltaThreshold} token delta (delta=${tokenDelta}, iter=${state.iteration})`);
          state = transitionState(state, {
            status: "done",
            meta: { ...state.meta, terminatedBy: "low_delta_guard" },
          });
          break;
        }
      }

      // ── Auto-checkpoint before context pressure gate ────────────────────
      // When approaching the hard pressure gate (within 5%), auto-save best
      // observations to the checkpoint store so they survive compaction.
      if (
        !autoCheckpointed &&
        shouldAutoCheckpoint({
          estimatedTokens: state.tokens,
          maxTokens: effectiveInput.contextProfile?.maxTokens ?? Number.MAX_SAFE_INTEGER,
          tier: profile.tier,
          alreadyCheckpointed: autoCheckpointed,
        })
      ) {
        const saved = yield* autoCheckpoint(checkpointStoreRef, state.steps);
        if (saved) {
          autoCheckpointed = true;
          yield* emitLog({ _tag: "warning", message: `[auto-checkpoint] Saved best observations before context pressure gate (tokens=${state.tokens})`, timestamp: new Date() });
        }
      }

      // Sync scratchpad: kernel may have added entries
      for (const [k, v] of state.scratchpad) {
        mutableScratchpad.set(k, v);
      }

      // ── Entropy scoring + Reactive Controller evaluation ────────────────
      ({ state, prevStepCount } = yield* runReactiveObserver(
        state, services, eventBus, prevStepCount, currentOptions,
      ));

      // Honor early-stop dispatched by the intervention dispatcher
      if (state.meta.terminatedBy === "dispatcher-early-stop") {
        state = transitionState(state, { status: "done", output: state.output ?? "" });
        break;
      }

      // ── Iteration progress hook ──────────────────────────────────────────
      // Compute which tools were called in THIS iteration by scanning new action
      // steps since prevStepCount. Includes duplicates so parallel batches
      // (e.g. 4x web-search) report all 4 calls, not just the unique name.
      const toolsThisStep: string[] = [];
      for (let i = prevActionCount; i < state.steps.length; i++) {
        const s = state.steps[i];
        if (s.type === "action") {
          const toolName = (s.metadata?.toolUsed ?? (s.metadata?.toolCall && (s.metadata.toolCall as { name?: string }).name)) as string | undefined;
          if (toolName) toolsThisStep.push(toolName);
        }
      }
      yield* hooks.onIterationProgress(state, toolsThisStep);
      prevActionCount = state.steps.length;

      // ── Lane controller (gather vs synthesize) ───────────────────────────
      const laneDecision = decideExecutionLane({
        requiredTools: currentInput.requiredTools ?? [],
        requiredToolQuantities: currentInput.requiredToolQuantities,
        steps: state.steps,
      });
      state = transitionState(state, {
        meta: {
          ...state.meta,
          executionLane: laneDecision.lane,
          missingRequiredTools: laneDecision.missingRequiredTools,
        },
      });

      // ── Harness artifact stall tracking ─────────────────────────────────
      // Track whether this iteration produced new non-meta tool observations.
      // The harness owns completion: when the model stalls but has gathered
      // useful data, it assembles and delivers the accumulated artifacts.
      const totalArtifacts = countDeliverableCandidates(state);
      const artifactDelta = Math.max(0, totalArtifacts - prevArtifactCount);
      consecutiveStalled = artifactDelta > 0 ? 0 : consecutiveStalled + 1;
      prevArtifactCount = totalArtifacts;

      if (
        consecutiveStalled >= 2 &&
        state.iteration >= 2 &&
        state.status === "thinking"
      ) {
        const missingRequiredByCount = laneDecision.missingRequiredTools;
        if (missingRequiredByCount.length > 0) {
          requiredToolNudgeCount++;
          if (requiredToolNudgeCount > maxRequiredToolNudges) {
            if (totalArtifacts > 0) {
              yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted (${maxRequiredToolNudges}) — delivering ${totalArtifacts} artifacts`, timestamp: new Date() });
              state = transitionState(state, {
                status: "done",
                output: assembleDeliverable(state),
                meta: { ...state.meta, terminatedBy: "harness_deliverable" },
              });
              break;
            }
            state = transitionState(state, {
              status: "failed",
              error: `Required tool quota not met after ${maxRequiredToolNudges} nudge attempts: ${missingRequiredByCount.join(", ")}`,
            });
            break;
          }
          const guidance =
            `Required tool quota not met: ${missingRequiredByCount.join(", ")}. ` +
            `Continue calling the missing required tool(s) before attempting completion.`;
          state = transitionState(state, {
            status: "thinking",
            steps: [...state.steps, makeStep("observation", `⚠️ ${guidance}`)],
            pendingGuidance: { requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
          });
          continue;
        }

        const recovery = getToolFailureRecovery(state, currentInput);
        const shouldNudgeRecovery =
          recovery.failedUnresolved.length > 0 &&
          failureRecoveryRedirects < maxFailureRecoveryRedirects;

        if (shouldNudgeRecovery) {
          failureRecoveryRedirects++;
          const guidance = buildRecoverySteeringGuidance(
            recovery,
            failureRecoveryRedirects,
            maxFailureRecoveryRedirects,
            "stall",
          );

          state = transitionState(state, {
            status: "thinking",
            steps: [...state.steps, makeStep("observation", `⚠️ ${guidance}`)],
            pendingGuidance: { errorRecovery: guidance },
            meta: {
              ...state.meta,
              recoveryPending: true,
              recoveryFailedTools: recovery.failedUnresolved,
              recoveryAlternativeCandidates: recovery.alternativeCandidates,
            },
          });
          continue;
        }

        if (totalArtifacts > 0) {
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Assembling output from ${totalArtifacts} tool artifacts after ${consecutiveStalled} stalled iterations`, timestamp: new Date() });
          state = transitionState(state, {
            status: "done",
            output: assembleDeliverable(state),
            meta: { ...state.meta, terminatedBy: "harness_deliverable" },
          });
          break;
        }
      }

      // ── Intelligent Context Synthesis (before thinking step) ──
      // Produces a steering nudge appended to the FC thread — never replaces it.
      // Skip when status is "acting" — tool calls are pending but haven't executed
      // yet, so toolsUsed is stale and any nudge would be contradictory.
      const oracleReady = getLastPulseReadyToAnswer(state);
      const shouldAllowIcsNudge =
        state.status === "thinking" && (!oracleReady || laneDecision.lane === "gather");
      const effectiveToolsUsed = buildEffectiveToolsUsed(state);
      if (shouldAllowIcsNudge) {
        const icsResult = yield* coordinateICS(state, {
          task: currentInput.task,
          requiredTools: currentInput.requiredTools ?? [],
          toolsUsed: effectiveToolsUsed,
          availableTools: (currentInput.availableToolSchemas ?? []) as readonly { name: string; description: string; parameters: unknown[] }[],
          tier: profile.tier ?? "mid",
          iteration: state.iteration,
          maxIterations: (state.meta.maxIterations as number) ?? 10,
          lastErrors: getLastErrors(state),
        });
        if (icsResult.steeringNudge) {
          state = transitionState(state, { pendingGuidance: { icsGuidance: icsResult.steeringNudge } });
        }
      }

      // ── Oracle hard gate (pulse readyToAnswer two-stage escalation) ──────
      // When the pulse tool has reported readyToAnswer=true but the model
      // has not called final-answer, escalate in two stages:
      //   Stage 1: inject a mandatory steering nudge, increment nudge count.
      //   Stage 2: after N ignored nudges (tier-dependent), force-exit with "oracle_forced".
      if (state.status !== "done" && state.status !== "failed") {
        const nudgeCount = state.readyToAnswerNudgeCount ?? 0;
        const shouldNudgeForOracle = shouldInjectOracleNudge({
          lane: laneDecision.lane,
          oracleReady,
        });

        if (
          shouldNudgeForOracle &&
          shouldForceOracleExit({ oracleReady, readyToAnswerNudgeCount: nudgeCount, tier: profile.tier })
        ) {
          // Stage 2: force exit — model has been nudged twice and still hasn't called final-answer
          yield* emitLog({ _tag: "warning", message: `[oracle-gate] Forcing exit after ${nudgeCount} ignored readyToAnswer signals`, timestamp: new Date() });
          const forcedOutput = state.output ?? state.steps.filter((s) => s.type === "thought").slice(-1)[0]?.content ?? "Task complete.";
          state = transitionState(state, {
            status: "done",
            output: forcedOutput,
            meta: { ...state.meta, terminatedBy: "oracle_forced" },
          });
        } else if (shouldNudgeForOracle) {
          // Stage 1: inject mandatory oracle guidance, increment count
          const mandatoryNudge = "You are ready to answer. Call `final-answer` now with your complete response. This is mandatory.";
          state = transitionState(state, {
            readyToAnswerNudgeCount: nudgeCount + 1,
            pendingGuidance: { oracleGuidance: mandatoryNudge },
          });
          yield* emitLog({ _tag: "warning", message: `[oracle-gate] Stage 1 nudge injected (nudgeCount now ${nudgeCount + 1})`, timestamp: new Date() });
        } else if (nudgeCount > 0) {
          // Oracle no longer eligible for synthesis nudges — reset count.
          // This includes both "oracle not ready" and gather-lane runs.
          state = transitionState(state, { readyToAnswerNudgeCount: 0 });
        }
      }

      // ── Early exit: primary scoped tools called ─────────────────────────
      // For composite steps in plan-execute, exit as soon as all primary
      // (non-utility) tools have been called.
      state = checkAllToolsCalled(state, currentInput, currentOptions);

      // ── Loop detection + strategy switching ─────────────────────────────
      // Check the most recent steps for patterns that indicate a stuck loop.
      // Only fire if the loop hasn't already terminated (status still active).
      if (state.status !== "done" && state.status !== "failed") {
        const loopMsg = detectLoop(
          state.steps,
          maxSameTool,
          maxRepeatedThought,
          maxConsecutiveThoughts,
        );

        // ── Strategy switching ────────────────────────────────────────────
        if (loopMsg !== null) {
          const switchCfg = options.strategySwitching;
          const maxSwitches = switchCfg?.maxSwitches ?? 1;

          if (switchCfg?.enabled && switchCount < maxSwitches) {
            // Transition to "evaluating" while we decide
            state = transitionState(state, { status: "evaluating" });

            let evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string };

            if (switchCfg.fallbackStrategy) {
              // Skip LLM evaluator — use fallback directly
              evaluation = {
                shouldSwitch: true,
                recommendedStrategy: switchCfg.fallbackStrategy,
                reasoning: "fallback strategy configured",
              };
            } else {
              // Ask the LLM evaluator to pick the best alternative
              const available = switchCfg.availableStrategies ?? [];
              evaluation = yield* evaluateStrategySwitch(
                state,
                currentInput.task ?? "",
                available,
                triedStrategies,
              );
            }

            // Fire evaluated hook regardless of whether switch will happen — observability
            yield* hooks.onStrategySwitchEvaluated(state, evaluation);

            if (evaluation.shouldSwitch && evaluation.recommendedStrategy) {
              const fromStrategy = triedStrategies[triedStrategies.length - 1] ?? "unknown";
              const toStrategy = evaluation.recommendedStrategy;

              // Fire hook
              yield* hooks.onStrategySwitched(state, fromStrategy, toStrategy, evaluation.reasoning);

              // Build handoff context for the new strategy
              const handoff = buildHandoff(
                state,
                currentInput.task ?? "",
                fromStrategy,
                loopMsg,
                switchCount + 1,
              );

              const handoffSummary = [
                `Strategy Switch Handoff (switch #${handoff.switchNumber}):`,
                `Previous strategy: ${handoff.previousStrategy}`,
                `Steps completed: ${handoff.stepsCompleted}`,
                `Failure reason: ${handoff.failureReason}`,
                `Tools called: ${handoff.toolsCalled.join(", ") || "none"}`,
                `Key observations:\n${handoff.keyObservations.join("\n") || "(none)"}`,
              ].join("\n");

              // Re-init state with the new strategy
              switchCount++;
              triedStrategies.push(toStrategy);

              currentOptions = {
                ...options,
                strategy: toStrategy,
              };

              // Reset state — fresh iteration count, carry forward toolsUsed
              state = initialKernelState(currentOptions);

              // Build updated input with handoff context
              const existingPrior = currentInput.priorContext
                ? `${currentInput.priorContext}\n\n${handoffSummary}`
                : handoffSummary;

              currentInput = {
                ...currentInput,
                priorContext: existingPrior,
              };

              // Rebuild context with the updated input
              currentContext = {
                ...context,
                input: currentInput,
              };

              // Reset per-loop tracking
              prevActionCount = 0;
              requiredToolRedirects = 0;
              consecutiveStalled = 0;
              prevArtifactCount = 0;
              failureRecoveryRedirects = 0;

              // Continue the outer while loop with fresh state
              continue;
            }
          }

          // Before failing: if the model has gathered artifacts, succeed with them.
          // Loops with data → deliver. Loops without data → fail.
          const recovery = getToolFailureRecovery(state, currentInput);
          const shouldNudgeRecovery =
            recovery.failedUnresolved.length > 0 &&
            failureRecoveryRedirects < maxFailureRecoveryRedirects;

          if (shouldNudgeRecovery) {
            failureRecoveryRedirects++;
            const guidance = buildRecoverySteeringGuidance(
              recovery,
              failureRecoveryRedirects,
              maxFailureRecoveryRedirects,
              "loop",
            );
            state = transitionState(state, {
              status: "thinking",
              steps: [...state.steps, makeStep("observation", `⚠️ ${guidance}`)],
              pendingGuidance: { errorRecovery: guidance },
              error: null,
            });
            continue;
          }

          const loopArtifactCount = countDeliverableCandidates(state);
          if (loopArtifactCount > 0) {
            const missingRequiredByCount = missingRequiredToolsForInput(state.steps, currentInput);
            if (missingRequiredByCount.length > 0) {
              requiredToolNudgeCount++;
              if (requiredToolNudgeCount > maxRequiredToolNudges) {
                yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted in loop detection (${maxRequiredToolNudges}) — delivering ${loopArtifactCount} artifacts`, timestamp: new Date() });
                state = transitionState(state, {
                  status: "done",
                  output: assembleDeliverable(state),
                  meta: { ...state.meta, terminatedBy: "harness_deliverable" },
                });
                break;
              }
              const guidance =
                `Loop detected but required tool quota is still missing: ${missingRequiredByCount.join(", ")}. ` +
                `Call the missing required tool(s) now instead of finalizing.`;
              state = transitionState(state, {
                status: "thinking",
                steps: [...state.steps, makeStep("observation", `⚠️ ${guidance}`)],
                pendingGuidance: { loopDetected: true, requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
                error: null,
              });
              continue;
            }

            yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Loop detected but ${loopArtifactCount} artifacts gathered — delivering instead of failing`, timestamp: new Date() });
            state = transitionState(state, {
              status: "done",
              output: assembleDeliverable(state),
              meta: { ...state.meta, terminatedBy: "harness_deliverable" },
            });
            break;
          }

          // Distinguish: if no tool calls were attempted, it's a pure thought loop.
          // Degrade gracefully — deliver the last thought rather than a cryptic error.
          // If tool calls were attempted but produced no deliverable results, it IS
          // a genuine failure (the agent tried tools and got stuck).
          const hasToolAttempts = state.steps.some((s) => s.type === "action");
          if (hasToolAttempts) {
            state = transitionState(state, {
              status: "failed",
              error: loopMsg,
            });
          } else {
            const lastThought = [...state.steps].reverse().find((s) => s.type === "thought");
            state = transitionState(state, {
              status: "done",
              output: lastThought?.content ?? loopMsg,
              meta: { ...state.meta, terminatedBy: "loop_graceful" },
            });
          }
          break;
        }
      } // end if (state.status !== "done" && state.status !== "failed")

      // ── Required tools guard (in-loop) ─────────────────────────────────
      // When the kernel declares "done" but required tools haven't been called,
      // redirect back to "thinking" with a feedback step — up to the retry limit.
      if (state.status === "done" && requiredTools.length > 0) {
        const missingTools = missingRequiredToolsForInput(state.steps, currentInput);
        if (missingTools.length > 0) {
          requiredToolRedirects++;
          if (requiredToolRedirects > maxRequiredToolRetries) {
            state = transitionState(state, {
              status: "failed",
              error: `Task incomplete — the model never called required tool(s): ${missingTools.join(", ")} ` +
                `(after ${maxRequiredToolRetries} redirect attempts).\n` +
                `Fix: (1) Make the task description explicitly name the expected output ` +
                `(e.g. "write the result to ./report.md"), ` +
                `(2) Add a persona instruction: "You MUST call ${missingTools[0]} as the final step", ` +
                `(3) Increase retries: .withReasoning({ maxRequiredToolRetries: 4 }).`,
            });
            break;
          }
          // Inject feedback and redirect back to thinking
          const feedbackStep = makeStep(
            "observation",
            `⚠️ Required tools not yet used: ${missingTools.join(", ")}. ` +
            `You MUST call ${missingTools.length === 1 ? "this tool" : "these tools"} before completing the task. ` +
            `(Redirect ${requiredToolRedirects}/${maxRequiredToolRetries})`,
          );
          state = transitionState(state, {
            status: "thinking",
            output: null,
            steps: [...state.steps, feedbackStep],
          });
          // Continue the loop — kernel will see the feedback in steps
        }
      }
    }

    // ── 8. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited without failure but required quotas
    // are still missing, fail with a deterministic missing_required_tool error.
    // This applies uniformly across all non-failed exits.
    if (state.status !== "failed" && requiredTools.length > 0) {
      const effectiveToolsUsed = buildEffectiveToolsUsed(state);
      const missingTools = missingRequiredToolsForInput(state.steps, currentInput);
      if (missingTools.length > 0) {
        const visibleTools = (currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const allKnownTools = (currentInput.allToolSchemas ?? currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const calledTools = [...effectiveToolsUsed];
        const terminatedBy = String(
          state.meta.terminatedBy ??
            (state.iteration >= currentOptions.maxIterations ? "max_iterations" : "unknown"),
        );
        state = transitionState(state, {
          status: "failed",
          error:
            `Task incomplete — missing_required_tool: required tool(s) not called: ${missingTools.join(", ")}.\n` +
            `required=[${requiredTools.join(", ")}]\n` +
            `called=[${calledTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]\n` +
            `terminatedBy=${terminatedBy}`,
        });
      }
    }

    // ── 9. Output quality gate ────────────────────────────────────────────
    // Route all successful outputs through the canonical finalization pipeline.
    // Validates format, optionally synthesizes when LLM is available.
    // Harness-assembled output (raw tool artifacts) always attempts synthesis.
    if (state.status === "done" && state.output) {
      const terminationSource = (state.meta.terminatedBy === "oracle_forced" ? "oracle"
        : state.meta.terminatedBy === "harness_deliverable" || state.meta.terminatedBy === "low_delta_guard" ? "harness"
        : "model") as "model" | "harness" | "oracle" | "fallback";
      const candidate = buildFinalAnswerCandidate(
        state.output,
        terminationSource,
        taskIntent,
      );
      const finalized = yield* finalizeOutput(candidate, taskIntent, effectiveInput.task);

      // Determine if synthesis is needed:
      // 1. Explicit format requested but validation failed
      // 2. Harness/oracle source — raw tool artifacts need professional formatting
      const needsSynthesis = !finalized.formatValidated &&
        (taskIntent.format || terminationSource === "harness" || terminationSource === "oracle");

      if (needsSynthesis) {
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag === "Some") {
          const synthesisFormat = taskIntent.format ?? "prose";
          const synthesisPrompt = buildSynthesisPrompt(state.output, synthesisFormat, effectiveInput.task, taskIntent);
          const synthesized = yield* llmOpt.value.complete({
            messages: [{ role: "user", content: synthesisPrompt }],
            maxTokens: 1500,
            temperature: 0.2,
          }).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));

          if (synthesized.content && synthesized.content.length > 0) {
            const formatOk = taskIntent.format
              ? validateOutputFormat(synthesized.content, taskIntent.format).valid
              : true;
            const contentOk = validateContentCompleteness(synthesized.content, taskIntent).complete;

            if (formatOk && contentOk) {
              state = transitionState(state, {
                output: synthesized.content,
                meta: { ...state.meta, outputSynthesized: true, outputFormatValidated: true },
              });
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesized output to match requested format: ${synthesisFormat}`, timestamp: new Date() });
            } else if (terminationSource === "harness" || terminationSource === "oracle") {
              state = transitionState(state, {
                output: synthesized.content,
                meta: { ...state.meta, outputSynthesized: true, outputFormatValidated: formatOk, outputFormatReason: !formatOk ? "Format mismatch after synthesis" : !contentOk ? "Content incomplete after synthesis" : undefined },
              });
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis imperfect but using over raw artifacts (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            } else {
              state = transitionState(state, {
                meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
              });
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis attempted but validation still failed (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            }
          } else {
            state = transitionState(state, {
              meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
            });
          }
        } else {
          state = transitionState(state, {
            meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
          });
        }
      } else if (taskIntent.format) {
        // Format was requested and validated successfully
        state = transitionState(state, {
          meta: { ...state.meta, outputFormatValidated: true },
        });
      }
    }

    // ── 10. Terminal hooks ────────────────────────────────────────────────────
    if (state.status === "done") {
      yield* hooks.onDone(state);
    } else if (state.status === "failed") {
      yield* hooks.onError(state, state.error ?? "unknown error");
    }

    // ── 11. Return final state ────────────────────────────────────────────────
    return state;
  });
}
