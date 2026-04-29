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
import { createToolCallResolver, NativeFCDriver, TextParseDriver } from "@reactive-agents/tools";
import { checkpointStoreRef } from "@reactive-agents/tools";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { resolveStrategyServices } from "../../kernel/utils/service-utils.js";
import { buildKernelHooks } from "../../kernel/state/kernel-hooks.js";
import { terminate } from "./terminate.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
} from "../../kernel/state/kernel-state.js";
import { evaluateStrategySwitch, buildHandoff } from "../../kernel/capabilities/reflect/strategy-evaluator.js";
import { coordinateICS } from "../../kernel/utils/ics-coordinator.js";
import { runReactiveObserver } from "../../kernel/capabilities/reflect/reactive-observer.js";
import { detectLoop, checkAllToolsCalled } from "../../kernel/capabilities/reflect/loop-detector.js";
// Sprint 3.3 — Sole Termination Authority: dispatcher-early-stop now flows
// through the Arbitrator so the veto applies (catches "framework giving
// up due to maxIterations approach with tool failures" as exit-failure).
import {
  arbitrateAndApply,
  arbitrationContextFromState,
} from "../../kernel/capabilities/decide/arbitrator.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsByCount,
  getEffectiveMissingRequiredTools,
  getPermanentlyFailedRequiredTools,
} from "../../kernel/capabilities/verify/requirement-state.js";
import {
  decideExecutionLane,
  shouldInjectOracleNudge,
} from "../../kernel/utils/lane-controller.js";
import { extractOutputFormat, type TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";
import { defaultVerifier, defaultVerifierRetryPolicy } from "../../kernel/capabilities/verify/verifier.js";
import {
  emitKernelStateSnapshot,
  emitVerifierVerdict,
  emitHarnessSignalInjected,
} from "../../kernel/utils/diagnostics.js";
import { shouldAutoCheckpoint, autoCheckpoint } from "./auto-checkpoint.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildFinalAnswerCandidate,
  finalizeOutput,
  buildSynthesisPrompt,
  type FinalizedOutput,
} from "./output-synthesis.js";

import { META_TOOLS as RUNNER_META_TOOLS } from "../../kernel/state/kernel-constants.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

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
    const { toolService, eventBus, memoryService } = services;

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
    // Select tool calling driver from calibration. Default to NativeFCDriver
    // for uncalibrated ("none") or unknown models — tools must reach the LLM.
    // Only use TextParseDriver when calibration explicitly says "text-parse".
    const toolCallingDriver =
      effectiveInput.calibration?.toolCallDialect === "text-parse"
        ? new TextParseDriver()
        : new NativeFCDriver();

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
      toolCallingDriver,
      memoryService,
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

    // Verifier-driven retry budget (Sprint 3.5 Stage 2) — converts honest
    // verifier rejections into recovery attempts. When the model ships a
    // candidate final-answer that fails verification (e.g., agent-took-action
    // because no data tool was invoked, or synthesis-grounded because the
    // output fabricates content), we inject the verdict reason as a feedback
    // step and let the kernel try once more with that guidance.
    //
    // Cap is intentionally low (1) — the architectural mechanism is one
    // chance to recover from a rejection. If the model ignores even specific
    // verifier feedback, the failure mode is compliance, not chance to retry.
    //
    // Both the verifier and the retry policy are developer-injectable
    // (Sprint 3.5 Stage 2.5 — control pillar): swap `defaultVerifier` for a
    // domain-specific check, swap `defaultVerifierRetryPolicy` to suppress
    // retry on known-regressing task shapes (e.g., long-form synthesis).
    let verifierRetries = 0;
    const maxVerifierRetries = effectiveInput.maxVerifierRetries ?? 1;
    const verifier = effectiveInput.verifier ?? defaultVerifier;
    const verifierRetryPolicy =
      effectiveInput.verifierRetryPolicy ?? defaultVerifierRetryPolicy;

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
            ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/loop/runner.ts:580", tag: errorTag(err) })))
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

      // Snapshot kernel state at iteration start — gives `rax diagnose` and
      // Cortex UI a per-iteration baseline of what the agent saw.
      yield* emitKernelStateSnapshot({
        state,
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
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
          state = terminate(state, {
            reason: "low_delta_guard",
            output: state.output ?? "",
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

      // Honor early-stop dispatched by the intervention dispatcher.
      // Sprint 3.3 — flow through the Arbitrator so the veto can convert
      // a "framework giving up because of approaching maxIterations"
      // early-stop into status:failed when there's tool-failure evidence.
      if (state.meta.terminatedBy === "dispatcher-early-stop") {
        state = arbitrateAndApply(
          state,
          {
            kind: "controller-early-stop",
            output: state.output ?? "",
            reason: "dispatcher_early_stop",
          },
          arbitrationContextFromState(state, {
            task: input.task,
            requiredTools: input.requiredTools,
          }),
        );
        break;
      }

      // Apply temperature override dispatched by the intervention dispatcher
      if (typeof (state.meta as Record<string, unknown>).dispatchedTemperature === "number") {
        currentOptions = {
          ...currentOptions,
          temperature: (state.meta as Record<string, unknown>).dispatchedTemperature as number,
        };
      }

      // Honor dispatcher-requested strategy switch
      if (state.meta.terminatedBy === "dispatcher-strategy-switch") {
        const pending = (state.meta as Record<string, unknown>).dispatchedStrategySwitch as
          | { to: string; reason: string }
          | undefined;
        const switchCfg = options.strategySwitching;
        const maxSwitches = switchCfg?.maxSwitches ?? 1;
        if (pending && switchCfg?.enabled && switchCount < maxSwitches) {
          const fromStrategy = triedStrategies[triedStrategies.length - 1] ?? currentOptions.strategy ?? "unknown";
          const toStrategy = pending.to;
          yield* hooks.onStrategySwitched(state, fromStrategy, toStrategy, pending.reason);
          const handoff = buildHandoff(state, currentInput.task ?? "", fromStrategy, pending.reason, switchCount + 1, currentInput.requiredTools ?? []);
          const handoffSummary = [
            `Strategy Switch Handoff (switch #${handoff.switchNumber}):`,
            `Previous strategy: ${handoff.previousStrategy}`,
            `Steps completed: ${handoff.stepsCompleted}`,
            `Failure reason: ${handoff.failureReason}`,
            `Tools called: ${handoff.toolsCalled.join(", ") || "none"}`,
            handoff.permanentlyFailedTools.length > 0
              ? `Permanently unavailable tools (do not retry — synthesize without them): ${handoff.permanentlyFailedTools.join(", ")}`
              : null,
            `Key observations:\n${handoff.keyObservations.join("\n") || "(none)"}`,
          ].filter(Boolean).join("\n");
          switchCount++;
          triedStrategies.push(toStrategy);
          currentOptions = { ...options, strategy: toStrategy };
          state = initialKernelState(currentOptions);
          // Inject synthetic failure observations so the new strategy immediately
          // knows which required tools are permanently unavailable.
          if (handoff.permanentlyFailedTools.length > 0) {
            const failedSteps = handoff.permanentlyFailedTools.map((toolName) =>
              makeStep(
                "observation",
                `[Carried from prior strategy] Tool "${toolName}" is permanently unavailable — every call failed. Do not retry it; synthesize your answer without this data.`,
                {
                  observationResult: {
                    toolName,
                    success: false,
                    displayText: `Tool "${toolName}" permanently unavailable (carried from prior strategy)`,
                    category: "error" as const,
                    resultKind: "error" as const,
                    preserveOnCompaction: false,
                    // S2.3 — error observations carry framework-generated text only,
                    // safe to render inline. Mark as trusted with grandfather note.
                    trustLevel: "trusted" as const,
                    trustJustification: "grandfather-phase-1",
                  },
                },
              ),
            );
            state = transitionState(state, { steps: [...state.steps, ...failedSteps] });
          }
          const existingPrior = currentInput.priorContext
            ? `${currentInput.priorContext}\n\n${handoffSummary}`
            : handoffSummary;
          {
            const failedSet = new Set(handoff.permanentlyFailedTools);
            currentInput = {
              ...currentInput,
              priorContext: existingPrior,
              requiredTools: failedSet.size > 0
                ? (currentInput.requiredTools ?? []).filter((t) => !failedSet.has(t))
                : currentInput.requiredTools,
            };
          }
          currentContext = { ...context, input: currentInput };
          prevActionCount = 0;
          requiredToolRedirects = 0;
          consecutiveStalled = 0;
          prevArtifactCount = 0;
          failureRecoveryRedirects = 0;
          continue;
        }
        // Switching not enabled or exhausted — deliver what we have
        state = terminate(state, {
          reason: "switching_exhausted",
          output: state.output ?? "",
        });
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

      // When reactive intelligence is active it needs at least iteration 2 before it
      // can evaluate early-stop. Give it runway by raising the stall threshold to 4
      // so the RI evaluator always gets a chance to act before the harness fires.
      // Detection is purely structural — `services.reactiveController._tag === "Some"`
      // avoids importing anything from the reactive-intelligence package.
      const riActive = services.reactiveController._tag === "Some";
      const stallThreshold = riActive ? 4 : 2;

      if (
        consecutiveStalled >= stallThreshold &&
        state.iteration >= 2 &&
        state.status === "thinking"
      ) {
        const missingRequiredByCount = laneDecision.missingRequiredTools;
        if (missingRequiredByCount.length > 0) {
          requiredToolNudgeCount++;
          if (requiredToolNudgeCount > maxRequiredToolNudges) {
            if (totalArtifacts > 0) {
              yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted (${maxRequiredToolNudges}) — delivering ${totalArtifacts} artifacts`, timestamp: new Date() });
              state = terminate(state, {
                reason: "harness_deliverable",
                output: assembleDeliverable(state),
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
          yield* emitHarnessSignalInjected({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            signalKind: "nudge",
            origin: "runner.ts:875",
            content: guidance,
            metadata: { missingTools: missingRequiredByCount, nudgeCount: requiredToolNudgeCount },
          });
          state = transitionState(state, {
            status: "thinking",
            steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
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

          yield* emitHarnessSignalInjected({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            signalKind: "redirect",
            origin: "runner.ts:897",
            content: guidance,
            metadata: {
              failedTools: recovery.failedUnresolved,
              alternatives: recovery.alternativeCandidates,
              redirectCount: failureRecoveryRedirects,
            },
          });
          state = transitionState(state, {
            status: "thinking",
            steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
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
          state = terminate(state, {
            reason: "harness_deliverable",
            output: assembleDeliverable(state),
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
          // Output-boundary discipline (per types/step.ts isUserVisibleStep):
          // never substitute a hard-coded harness phrase ("Task complete.")
          // for missing model output. If neither state.output nor a real
          // thought exists, fail with a structured reason — the
          // transitionState invariant nulls the output for the user.
          const oracleForcedOutput = state.output ?? state.steps.filter((s) => s.type === "thought").slice(-1)[0]?.content;
          if (oracleForcedOutput && oracleForcedOutput.trim().length > 0) {
            state = terminate(state, {
              reason: "oracle_forced",
              output: oracleForcedOutput,
            });
          } else {
            state = transitionState(state, {
              status: "failed",
              error: `Oracle forced exit after ${nudgeCount} ignored readyToAnswer signals, but the model never produced a deliverable answer.`,
              meta: { ...state.meta, terminatedBy: "oracle_forced" },
            });
          }
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
                currentInput.requiredTools ?? [],
              );

              const handoffSummary = [
                `Strategy Switch Handoff (switch #${handoff.switchNumber}):`,
                `Previous strategy: ${handoff.previousStrategy}`,
                `Steps completed: ${handoff.stepsCompleted}`,
                `Failure reason: ${handoff.failureReason}`,
                `Tools called: ${handoff.toolsCalled.join(", ") || "none"}`,
                handoff.permanentlyFailedTools.length > 0
                  ? `Permanently unavailable tools (do not retry — synthesize without them): ${handoff.permanentlyFailedTools.join(", ")}`
                  : null,
                `Key observations:\n${handoff.keyObservations.join("\n") || "(none)"}`,
              ].filter(Boolean).join("\n");

              // Re-init state with the new strategy
              switchCount++;
              triedStrategies.push(toStrategy);

              currentOptions = {
                ...options,
                strategy: toStrategy,
              };

              // Reset state — fresh iteration count, carry forward toolsUsed
              state = initialKernelState(currentOptions);

              // Inject synthetic failure observations so the new strategy immediately
              // knows which required tools are permanently unavailable, without having
              // to rediscover this through wasted retry iterations.
              if (handoff.permanentlyFailedTools.length > 0) {
                const failedSteps = handoff.permanentlyFailedTools.map((toolName) =>
                  makeStep(
                    "observation",
                    `[Carried from prior strategy] Tool "${toolName}" is permanently unavailable — every call failed. Do not retry it; synthesize your answer without this data.`,
                    {
                  observationResult: {
                    toolName,
                    success: false,
                    displayText: `Tool "${toolName}" permanently unavailable (carried from prior strategy)`,
                    category: "error" as const,
                    resultKind: "error" as const,
                    preserveOnCompaction: false,
                    // S2.3 — error observations carry framework-generated text only,
                    // safe to render inline. Mark as trusted with grandfather note.
                    trustLevel: "trusted" as const,
                    trustJustification: "grandfather-phase-1",
                  },
                },
                  ),
                );
                state = transitionState(state, { steps: [...state.steps, ...failedSteps] });
              }

              // Build updated input with handoff context.
              // Also drop permanently-failed tools from requiredTools — the lane
              // controller uses this list to decide whether to nudge, and nudging for
              // a tool that's known to be broken only causes retry loops.
              const existingPrior = currentInput.priorContext
                ? `${currentInput.priorContext}\n\n${handoffSummary}`
                : handoffSummary;

              {
                const failedSet = new Set(handoff.permanentlyFailedTools);
                currentInput = {
                  ...currentInput,
                  priorContext: existingPrior,
                  requiredTools: failedSet.size > 0
                    ? (currentInput.requiredTools ?? []).filter((t) => !failedSet.has(t))
                    : currentInput.requiredTools,
                };
              }

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
            yield* emitHarnessSignalInjected({
              taskId: currentOptions.taskId ?? state.taskId,
              iteration: state.iteration,
              signalKind: "redirect",
              origin: "runner.ts:1173",
              content: guidance,
              metadata: {
                failedTools: recovery.failedUnresolved,
                redirectCount: failureRecoveryRedirects,
                trigger: "loop",
              },
            });
            state = transitionState(state, {
              status: "thinking",
              steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
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
                state = terminate(state, {
                  reason: "harness_deliverable",
                  output: assembleDeliverable(state),
                });
                break;
              }
              const guidance =
                `Loop detected but required tool quota is still missing: ${missingRequiredByCount.join(", ")}. ` +
                `Call the missing required tool(s) now instead of finalizing.`;
              yield* emitHarnessSignalInjected({
                taskId: currentOptions.taskId ?? state.taskId,
                iteration: state.iteration,
                signalKind: "nudge",
                origin: "runner.ts:1199",
                content: guidance,
                metadata: { missingTools: missingRequiredByCount, trigger: "loop-with-missing-tools" },
              });
              state = transitionState(state, {
                status: "thinking",
                steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
                pendingGuidance: { loopDetected: true, requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
                error: null,
              });
              continue;
            }

            yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Loop detected but ${loopArtifactCount} artifacts gathered — delivering instead of failing`, timestamp: new Date() });
            state = terminate(state, {
              reason: "harness_deliverable",
              output: assembleDeliverable(state),
            });
            break;
          }

          // Distinguish: if no tool calls were attempted, it's a pure thought loop.
          // Degrade gracefully — deliver the last thought rather than a cryptic error.
          // If tool calls were attempted but produced no deliverable results, it IS
          // a genuine failure (the agent tried tools and got stuck).
          //
          // Output-boundary discipline (per types/step.ts isUserVisibleStep):
          // when the lastThought has no real content, do NOT substitute the
          // loop-detector diagnostic as the user-visible answer — that's a
          // harness internal. Instead, fail with the diagnostic in `error`
          // so the transitionState invariant nulls the output and the user
          // sees a structured failure rather than developer-targeted advice.
          const hasToolAttempts = state.steps.some((s) => s.type === "action");
          if (hasToolAttempts) {
            state = transitionState(state, {
              status: "failed",
              error: loopMsg,
            });
          } else {
            const lastThought = [...state.steps].reverse().find((s) => s.type === "thought");
            const lastThoughtContent = lastThought?.content;
            if (lastThoughtContent && lastThoughtContent.trim().length > 0) {
              state = terminate(state, {
                reason: "loop_graceful",
                output: lastThoughtContent,
              });
            } else {
              state = transitionState(state, {
                status: "failed",
                error: loopMsg,
              });
            }
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

      // ── Verifier-driven retry (in-loop, Sprint 3.5 Stage 2) ──────────────
      // When the kernel declares "done" with a candidate final-answer but the
      // verifier rejects it (agent-took-action, synthesis-grounded, etc.),
      // give the model one more iteration with the verdict reason injected
      // as a feedback step. This converts the verifier from a pure terminal
      // gate (fail on rejection) into a guided retry — the highest-leverage
      // move for raising actual task success rates without changing the
      // verifier's strict pass/fail semantics.
      //
      // Cap is intentionally tight (default 1). If the model ignores even
      // verifier-specific feedback, the failure mode is compliance, not
      // chance to retry — and the next §9.0 outer gate will fail the run
      // definitively after this redirect's iter.
      if (
        state.status === "done" &&
        state.output &&
        verifierRetries < maxVerifierRetries &&
        state.iteration < currentOptions.maxIterations - 1
      ) {
        const availableUserTools = (currentInput.availableToolSchemas ?? []).map(
          (t) => t.name,
        );
        const verdict = verifier.verify({
          action: "final-answer",
          content: state.output,
          actionSuccess: true,
          task: currentInput.task,
          priorSteps: state.steps,
          requiredTools: currentInput.requiredTools,
          relevantTools: currentInput.relevantTools,
          toolsUsed: state.toolsUsed,
          availableUserTools,
          terminal: true,
        });
        if (!verdict.verified) {
          // Emit only on rejection — §9.0 outer gate handles the success
          // case, so without this branch every run would record 2 identical
          // verdict events for the same output.
          yield* emitVerifierVerdict({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            action: verdict.action,
            terminal: true,
            verified: verdict.verified,
            summary: verdict.summary,
            checks: verdict.checks,
          });
          // Consult the (possibly developer-overridden) retry policy. The
          // policy can suppress retry for known-regressing task shapes,
          // customize the harness signal, or surface a reason for audit.
          const decision = verifierRetryPolicy({
            verdict,
            iteration: state.iteration,
            retriesUsed: verifierRetries,
            maxRetries: maxVerifierRetries,
            stepCount: state.steps.length,
            toolsUsed: state.toolsUsed,
          });
          if (decision.retry) {
            verifierRetries++;
            const failedCheck = verdict.checks.find((c) => !c.passed);
            const fallbackText =
              `[verifier] Your draft answer was rejected at "${failedCheck?.name ?? "verification"}": ${failedCheck?.reason ?? verdict.summary}\n` +
              `Address this specific gap and try again. (retry ${verifierRetries}/${maxVerifierRetries})`;
            const signalText = decision.signalText ?? fallbackText;
            const signalStep = makeStep("observation", signalText);
            yield* emitHarnessSignalInjected({
              taskId: currentOptions.taskId ?? state.taskId,
              iteration: state.iteration,
              signalKind: "redirect",
              content: signalText,
              origin: `runner.ts:verifier-retry${decision.reason ? ` (${decision.reason})` : ""}`,
            });
            state = transitionState(state, {
              status: "thinking",
              output: null,
              steps: [...state.steps, signalStep],
            });
          }
        }
      }

      // ── Post-iteration snapshot ──────────────────────────────────────────
      // Capture state AFTER kernel() ran and post-processing finalized.
      // Without this, traces only show iter-start (steps=0) and the verifier
      // verdict — no visibility into step composition, output, or terminatedBy
      // for the iter that actually produced output. See diagnostic gap found
      // 2026-04-27 (T4: 6 events, status=done invisible).
      yield* emitKernelStateSnapshot({
        state,
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
      });
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
        // Render quantities so the user sees N/M satisfaction rather than a bare
        // tool name. Without this, a quota of 2 with 1 successful call looks
        // identical to "tool never called" in the error output.
        const successCounts = buildSuccessfulToolCallCounts(state.steps);
        const quantities = currentInput.requiredToolQuantities ?? {};
        const renderRequirement = (name: string) => {
          const need = quantities[name] ?? 1;
          const have = successCounts[name] ?? 0;
          return need > 1 ? `${name}×${need} (${have}/${need} satisfied)` : name;
        };
        // Invariant: status=failed implies output=null. Earlier paths
        // (loop_graceful, harness_deliverable) may have populated state.output
        // with a lastThought or assembled artifacts; once required-tool
        // satisfaction fails the run, those become invalid deliverables and
        // must be discarded — otherwise they leak as the user-visible answer
        // even though the run is structurally a failure.
        state = transitionState(state, {
          status: "failed",
          output: null,
          error:
            `Task incomplete — missing_required_tool: required tool(s) not called: ${missingTools.map(renderRequirement).join(", ")}.\n` +
            `required=[${requiredTools.map(renderRequirement).join(", ")}]\n` +
            `called=[${calledTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]\n` +
            `terminatedBy=${terminatedBy}`,
        });
      }
    }

    // ── 8.5. Non-authoritative termination → harness deliverable ───────────
    // When the model stopped without explicitly calling `final-answer` (e.g. an
    // `end_turn` text after a failed tool call, or a dispatcher-forced early
    // stop) and there are substantive tool artifacts, swap state.output for the
    // assembled deliverable so the quality gate has real data to synthesize
    // from. Without this, whatever the model emitted in its last turn — often
    // an apology, a hallucination, or the raw text of the last observation —
    // leaks through as the final answer.
    //
    // Scoped narrowly to explicit "model ended turn without final-answer"
    // markers so strategies that deliver their own output without setting
    // `terminatedBy` keep control of the output.
    const nonFinalAnswerTerminations = new Set([
      "end_turn",
      "llm_end_turn",
      "dispatcher-early-stop",
      "low_delta_guard",
    ]);
    if (
      state.status === "done" &&
      typeof state.meta.terminatedBy === "string" &&
      nonFinalAnswerTerminations.has(state.meta.terminatedBy)
    ) {
      const artifactCount = countDeliverableCandidates(state);
      if (artifactCount > 0) {
        const previousTerminatedBy = state.meta.terminatedBy;
        const deliverable = assembleDeliverable(state);
        state = transitionState(state, {
          output: deliverable,
          meta: {
            ...state.meta,
            terminatedBy: "harness_deliverable",
            previousTerminatedBy,
          },
        });
      }
    }

    // ── 8.7. Output ownership consolidation ──────────────────────────────────
    // The kernel must own the final output. Strategy adapters (reactive.ts,
    // plan-execute.ts, etc.) historically had their own fallback chains
    // (state.output ?? lastThought ?? null) that ran AFTER runKernel returned
    // — bypassing the verifier gate below. Pull those fallbacks here so:
    //   1. state.output reflects exactly what the user will receive
    //   2. the verifier sees the actual deliverable before it ships
    //   3. strategy adapters can return state.output directly with no synthesis
    //
    // Only fills from lastThought when status=done. Failed runs were already
    // forced to output=null by the transitionState invariant.
    if (state.status === "done" && !state.output) {
      const lastThought = [...state.steps]
        .filter((s) => s.type === "thought")
        .pop();
      if (lastThought?.content && lastThought.content.trim().length > 0) {
        state = transitionState(state, { output: lastThought.content });
      }
    }

    // ── 9.0. Sprint 3.5 — Verifier gate before shipping any output ───────────
    // Per North Star §3 (Verify capability) — the harness MUST verify the
    // final output satisfies the task before declaring success. Without this,
    // the model can ship parroted system guidance ("Your next step: call X")
    // as its answer because the output is in state.output and status is "done".
    //
    // The defaultVerifier with terminal=true runs:
    //   - required-tools-satisfied (catches "no tool was called" parrots)
    //   - synthesis-grounded (catches fabricated content)
    //
    // On verifier rejection: transition to status="failed" with the verdict
    // in state.error. The reactive.ts strategy adapter (Sprint 3.4 stage 2)
    // already ensures state.error doesn't leak as state.output; user sees
    // null output + structured error.
    if (process.env.DEBUG_VERIFIER === "1") {
      console.error(`[VERIFIER-PRE] status=${state.status} hasOutput=${!!state.output} terminatedBy=${state.meta.terminatedBy} outLen=${(state.output ?? "").length} stepsCount=${state.steps.length}`);
    }

    // ── Terminal snapshot (pre-verifier) ─────────────────────────────────────
    // Records the exact state the verifier gate inspects. With both an iter-end
    // snapshot AND this terminal one, a trace narrative becomes complete:
    // iter-start → iter-end → terminal → verifier-verdict. Without this, you
    // can't tell whether the verifier rejected the kernel's true final state
    // or some intermediate state.
    yield* emitKernelStateSnapshot({
      state,
      taskId: currentOptions.taskId ?? state.taskId,
      iteration: state.iteration,
    });

    if (state.status === "done" && state.output) {
      if (process.env.DEBUG_VERIFIER === "1") {
        console.error(`[VERIFIER] required=${JSON.stringify(effectiveInput.requiredTools)} relevant=${JSON.stringify(effectiveInput.relevantTools)} used=${JSON.stringify([...state.toolsUsed])} output.head=${state.output.slice(0, 80)}`);
      }
      // availableUserTools — pass through the user-registered tool list
      // so the verifier can run classifier-independent "agent-took-action"
      // checks (rejects parrots / hallucinated answers / meta-tool dumps
      // when the user wired data tools but the agent never invoked them).
      const availableUserTools = (effectiveInput.availableToolSchemas ?? []).map(
        (t) => t.name,
      );
      const verdict = verifier.verify({
        action: "final-answer",
        content: state.output,
        actionSuccess: true,
        task: effectiveInput.task,
        priorSteps: state.steps,
        requiredTools: effectiveInput.requiredTools,
        relevantTools: effectiveInput.relevantTools,
        toolsUsed: state.toolsUsed,
        availableUserTools,
        terminal: true,
      });
      // Emit structured verdict to trace stream (replaces DEBUG_VERIFIER console).
      yield* emitVerifierVerdict({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        action: verdict.action,
        terminal: true,
        verified: verdict.verified,
        summary: verdict.summary,
        checks: verdict.checks,
      });
      if (process.env.DEBUG_VERIFIER === "1") {
        console.error(`[VERIFIER] verdict=${verdict.verified} summary=${verdict.summary}`);
        for (const c of verdict.checks) console.error(`  - ${c.name}: ${c.passed} ${c.reason ?? ''}`);
      }
      if (!verdict.verified) {
        yield* emitLog({
          _tag: "warning",
          message: `[verifier] terminal output rejected: ${verdict.summary}`,
          timestamp: new Date(),
        });
        state = transitionState(state, {
          status: "failed",
          error: `Verifier rejected output: ${verdict.summary}`,
          meta: {
            ...state.meta,
            verifierRejected: true,
            verifierVerdict: verdict.summary,
          } as KernelState["meta"],
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
