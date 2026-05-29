// File: src/kernel/loop/iterate-pass.ts
/**
 * Per-iteration body of `runKernel()` — lifted from `runner.ts` in WS-6 Phase 4
 * (2026-05-29) so runner.ts can return to "orchestrator only" scope.
 *
 * SCOPE
 * -----
 * One invocation = one pass through the while-loop body that used to live
 * inline in `runKernel()`. The outer while-loop condition + pre-loop setup +
 * post-loop finalization stay in `runner.ts`. This function owns ONLY what
 * happens between the opening `while (...)` brace and its closing `}`.
 *
 * SHAPE
 * -----
 * Mutable carrier + immutable cfg + control-signal return.
 *   - `IterationCarrier`: mutable holder for all variables that EITHER survive
 *     across iterations (counters, currentInput/Options/Context, switchCount,
 *     triedStrategies, mutableScratchpad) OR are read by the post-loop code
 *     (`currentInput`, `currentOptions`, `state`).
 *   - `IterationConfig`: immutable per-run inputs (kernel, hooks, services,
 *     profile, verifier, etc.).
 *   - Return `"continue"` | `"break"` — outer while honors the signal. Every
 *     original `break;` becomes `return "break";`; every original `continue;`
 *     becomes `return "continue";`; fall-through becomes a final
 *     `return "continue";`.
 *
 * INVARIANTS PRESERVED (do not violate)
 * -------------------------------------
 *   1. Single-owner termination: `terminate(state, ...)` is the only writer
 *      of state.status to "done"/"failed" outside `kernel-state.ts`. The lift
 *      preserves every call site verbatim — no new state.status writers.
 *   2. transitionState() discipline: every state mutation routes through
 *      `transitionState(state, patch)`. ESLint enforces.
 *   3. Loop-detector streak rule (`detectLoop` at IC-1): only ACTION steps
 *      reset `maxConsecutiveThoughts`. Observations do NOT. Preserved by
 *      moving the `detectLoop()` call verbatim.
 *   4. No LLM re-verify (M3 REWORK precedent): the verifier emit at the
 *      harness-deliverable branch is preserved exactly as-is — emit-only,
 *      no retry, the post-loop §9.0 gate is the sole consumer of rejection.
 *   5. Phase-chain ordering (sense → attend → comprehend → recall → reason →
 *      decide → act → verify → reflect → learn) is structural, not semantic —
 *      preserved by lifting the whole body, not its sub-blocks.
 *
 * HISTORY
 * -------
 *   - WS-6 Phase 2 (2026-05-28): runner.ts 1976 → 1615 via four helper buckets
 *     (tier-guards, deliverable, recovery-steering, state-queries) under
 *     `runner-helpers/`. Phase 2 UpwardReport flagged iteration-block lift as
 *     the highest-leverage remaining reduction.
 *   - WS-6 Phase 4 (2026-05-29): this file. Iteration body lifted whole;
 *     runner.ts drops below 1500 LOC (ceiling tightened in
 *     `packages/reasoning/test/runner-loc-ceiling.test.ts`).
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md §3 line 468 + §5.5a.
 */
import { Effect, FiberRef } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { checkpointStoreRef } from "@reactive-agents/tools";
import type { ContextProfile } from "../../context/context-profile.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { terminate } from "./terminate.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
  type KernelHooks,
} from "../../kernel/state/kernel-state.js";
import { evaluateStrategySwitch } from "../../kernel/capabilities/reflect/strategy-evaluator.js";
import { applyStrategySwitch } from "./runner-helpers/strategy-switch.js";
import { coordinateICS } from "../../kernel/utils/ics-coordinator.js";
import { runReactiveObserver } from "../../kernel/capabilities/reflect/reactive-observer.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import { detectLoop, checkAllToolsCalled } from "../../kernel/capabilities/reflect/loop-detector.js";
import {
  arbitrateAndApplyWithBudgetEmit,
  arbitrationContextFromState,
} from "../../kernel/capabilities/decide/arbitrator.js";
import { buildOracleNudge } from "../../kernel/capabilities/decide/oracle-nudge.js";
import {
  decideExecutionLane,
  shouldInjectOracleNudge,
} from "../../kernel/utils/lane-controller.js";
import { verifyAndEmit, type Verifier } from "../../kernel/capabilities/verify/verifier.js";
import { LearningPipeline } from "../../kernel/capabilities/learn/learning-pipeline.js";
import {
  RecallService,
  type MemoryRecallResult,
  type FoundSkill,
} from "../../kernel/capabilities/recall/recall-service.js";
import {
  emitKernelStateSnapshot,
  emitHarnessSignalInjected,
} from "../../kernel/utils/diagnostics.js";
import { shouldAutoCheckpoint, autoCheckpoint } from "./auto-checkpoint.js";
import { RunControllerRef } from "@reactive-agents/core";
import {
  TIER_GUARD_THRESHOLDS,
  shouldExitOnLowDelta,
  shouldForceOracleExit,
  type TierGuardConfig,
} from "./runner-helpers/tier-guards.js";
import {
  missingRequiredToolsForInput,
  getLastPulseReadyToAnswer,
  getLastErrors,
} from "./runner-helpers/state-queries.js";
import {
  assembleDeliverable,
  deliverableTerminationReason,
  countDeliverableCandidates,
  buildEffectiveToolsUsed,
} from "./runner-helpers/deliverable.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
} from "./runner-helpers/recovery-steering.js";

/**
 * Outer-loop control signal returned by `runIterationPass`.
 *
 *   - `"continue"` — the outer while loop should re-evaluate its condition and
 *     run another pass (the original body's fall-through OR an explicit
 *     `continue;` site).
 *   - `"break"` — the outer while loop should exit immediately (every original
 *     `break;` site — terminate, harness-deliverable, oracle-forced, etc.).
 */
export type IterationSignal = "continue" | "break";

/**
 * Mutable carrier — every field round-trips through one `runIterationPass`
 * invocation. Fields fall into two groups:
 *   (a) survive across iterations (counters, currentInput/Options/Context,
 *       switch tracking, autoCheckpointed, mutableScratchpad — a Map whose
 *       identity is preserved across iterations)
 *   (b) read by the post-loop finalization in runner.ts (state, currentInput,
 *       currentOptions)
 *
 * Fields are mutated in-place; `runIterationPass` doesn't return a fresh
 * carrier. Keeps the call site in runner.ts tiny:
 *   `const signal = yield* runIterationPass(carrier, cfg); if (signal === "break") break;`
 */
export interface IterationCarrier {
  state: KernelState;
  currentInput: KernelInput;
  currentOptions: KernelRunOptions;
  currentContext: KernelContext;
  /** Track tool calls per iteration by scanning new action steps since last check. */
  prevActionCount: number;
  /** Cursor for reactive-observer entropy delta (separate from learn cursor). */
  prevStepCount: number;
  /** Per-iter diff cursor for LearningPipeline.write() — observations slice. */
  prevStepCountForLearn: number;
  /** Per-iter diff cursor for LearningPipeline.write() — decisions slice. */
  prevDecisionLogCountForLearn: number;
  /** Total deliverable artifacts seen on the previous iteration (stall detection). */
  prevArtifactCount: number;
  /** Consecutive iterations with no new non-meta tool results. */
  consecutiveStalled: number;
  /** Times the harness redirected the model back to required tools. */
  requiredToolRedirects: number;
  /** Total nudge budget consumed (stall + loop paths combined). */
  requiredToolNudgeCount: number;
  /** Times the harness redirected after a tool path failed. */
  failureRecoveryRedirects: number;
  /** Number of strategy switches completed so far. */
  switchCount: number;
  /** Strategy names tried so far (initial + switches), in order. */
  triedStrategies: string[];
  /** True once auto-checkpoint has fired this run (fires at most once). */
  autoCheckpointed: boolean;
  /** Mirror of state.scratchpad kept across iterations (Map identity stable). */
  mutableScratchpad: Map<string, string>;
}

/**
 * Immutable per-run configuration — every field is set before the while loop
 * starts in runner.ts and never reassigned inside the iteration body.
 */
export interface IterationConfig {
  /** The strategy's ThoughtKernel — invoked once per iteration. */
  kernel: ThoughtKernel;
  /** Hooks bundle — runner.ts builds once from the EventBus. */
  hooks: KernelHooks;
  /** Resolved services bundle (LLM, ToolService, EventBus, RecallService, ...). */
  services: StrategyServices;
  /** Resolved context profile (tier-aware + calibration-aware). */
  profile: ContextProfile;
  /** Tier guard thresholds (tokenDeltaThreshold + oracleNudgeLimit + ...). */
  tierGuards: TierGuardConfig;
  /** Loop detector — max distinct same-tool calls. */
  maxSameTool: number;
  /** Loop detector — max repeated identical thoughts. */
  maxRepeatedThought: number;
  /** Loop detector — max consecutive thoughts without an action between. */
  maxConsecutiveThoughts: number;
  /** Required-tools floor from input (or empty array). */
  requiredTools: readonly string[];
  /** Cap on redirect attempts when required tools weren't called. */
  maxRequiredToolRetries: number;
  /** Cap on harness nudges injected to satisfy required tools. */
  maxRequiredToolNudges: number;
  /** Cap on recovery-steering redirects when a tool path fails. */
  maxFailureRecoveryRedirects: number;
  /** Verifier instance — defaultVerifier unless input overrode. */
  verifier: Verifier;
  /** Original options the kernel was invoked with (used by strategy switching). */
  options: KernelRunOptions;
  /** Original context built pre-loop (used as base when switching strategies). */
  context: KernelContext;
  /** The KernelInput used to seed the kernel (carries harnessPipeline + originals). */
  effectiveInput: KernelInput;
  /** The raw KernelInput parameter (used by dispatcher-early-stop arbitration). */
  input: KernelInput;
  /** Closure-bound log emit — re-created in runner.ts and threaded through. */
  emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}

/**
 * Run one iteration of the kernel main loop.
 *
 * This body is the verbatim contents of the original `runKernel()` while-loop
 * body (Phase 2 baseline lines 383-1286 of runner.ts). The lift uses
 * destructure-locals at the top + a `sync()` write-back helper so the body
 * itself doesn't need a single identifier rewrite — the original
 * `let state = ...`, `currentInput`, `currentOptions`, counters, etc. all
 * work as written. Only two mechanical changes:
 *
 *   - `break;` becomes `sync(); return "break";`
 *   - `continue;` becomes `sync(); return "continue";`
 *
 * Body fall-through (the original implicit "loop back" at the end of the
 * while body) becomes a final `sync(); return "continue";`.
 *
 * No semantic change. All comments preserved verbatim.
 */
export function runIterationPass(
  carrier: IterationCarrier,
  cfg: IterationConfig,
): Effect.Effect<IterationSignal, never, LLMService> {
  return Effect.gen(function* () {
    // ── Destructure mutable carrier into locals ─────────────────────────────
    // The body below references these as plain identifiers (matching the
    // pre-lift runner.ts identifiers exactly). `sync()` writes them back to
    // the carrier before every return so the outer while-loop and post-loop
    // finalization see the latest values.
    let state = carrier.state;
    let currentInput = carrier.currentInput;
    let currentOptions = carrier.currentOptions;
    let currentContext = carrier.currentContext;
    let prevActionCount = carrier.prevActionCount;
    let prevStepCount = carrier.prevStepCount;
    let prevStepCountForLearn = carrier.prevStepCountForLearn;
    let prevDecisionLogCountForLearn = carrier.prevDecisionLogCountForLearn;
    let prevArtifactCount = carrier.prevArtifactCount;
    let consecutiveStalled = carrier.consecutiveStalled;
    let requiredToolRedirects = carrier.requiredToolRedirects;
    let requiredToolNudgeCount = carrier.requiredToolNudgeCount;
    let failureRecoveryRedirects = carrier.failureRecoveryRedirects;
    let switchCount = carrier.switchCount;
    let autoCheckpointed = carrier.autoCheckpointed;
    // Reference-stable — array/Map identity preserved across iterations.
    const triedStrategies = carrier.triedStrategies;
    const mutableScratchpad = carrier.mutableScratchpad;
    // Acknowledge unused stable refs so strict-unused doesn't flip; they ARE
    // mutated in-place by code below (triedStrategies.push, mutableScratchpad.set).
    void triedStrategies;
    void mutableScratchpad;

    // ── Destructure immutable cfg ───────────────────────────────────────────
    const {
      kernel,
      hooks,
      services,
      profile,
      tierGuards,
      maxSameTool,
      maxRepeatedThought,
      maxConsecutiveThoughts,
      requiredTools,
      maxRequiredToolRetries,
      maxRequiredToolNudges,
      maxFailureRecoveryRedirects,
      verifier,
      options,
      context,
      effectiveInput,
      input,
      emitLog,
    } = cfg;
    // eventBus is destructured here to mirror the original runner.ts pre-loop
    // shape `const { toolService, eventBus, memoryService } = services;`. Only
    // eventBus is referenced in the iteration body (the others are bound
    // upstream into the KernelContext and not used inside this function).
    const { eventBus } = services;
    // Suppress unused-local for the locals the body conditionally references
    // (TypeScript noUnusedLocals would otherwise flag in lean configs).
    void kernel; void hooks; void services; void profile; void tierGuards;
    void maxSameTool; void maxRepeatedThought; void maxConsecutiveThoughts;
    void requiredTools; void maxRequiredToolRetries; void maxRequiredToolNudges;
    void maxFailureRecoveryRedirects; void verifier; void options; void context;
    void effectiveInput; void input; void emitLog; void eventBus;

    // ── Sync helper — write locals back to carrier ─────────────────────────
    // Called immediately before every `return "break" | "continue"` so the
    // outer while loop (which re-reads carrier on each pass) and the post-loop
    // finalization (which reads carrier.{state,currentInput,currentOptions})
    // see the up-to-date values.
    const sync = () => {
      carrier.state = state;
      carrier.currentInput = currentInput;
      carrier.currentOptions = currentOptions;
      carrier.currentContext = currentContext;
      carrier.prevActionCount = prevActionCount;
      carrier.prevStepCount = prevStepCount;
      carrier.prevStepCountForLearn = prevStepCountForLearn;
      carrier.prevDecisionLogCountForLearn = prevDecisionLogCountForLearn;
      carrier.prevArtifactCount = prevArtifactCount;
      carrier.consecutiveStalled = consecutiveStalled;
      carrier.requiredToolRedirects = requiredToolRedirects;
      carrier.requiredToolNudgeCount = requiredToolNudgeCount;
      carrier.failureRecoveryRedirects = failureRecoveryRedirects;
      carrier.switchCount = switchCount;
      carrier.autoCheckpointed = autoCheckpointed;
    };

    // ── ORIGINAL BODY VERBATIM (Phase 2 runner.ts lines 389-1285) ──────────
      // Pause/stop checkpoint: awaits resume() if paused, returns { stop: true } on stop().
      const _runCtl = yield* FiberRef.get(RunControllerRef);
      if (_runCtl) {
        const ctl = yield* Effect.promise(() => _runCtl.checkpoint());
        if (ctl?.stop) {
          state = transitionState(state, { status: "done", output: state.output ?? "" });
          sync(); return "break";
        }
      }

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

      // ── Recall capability — per-iter RecallService dispatch ──────────────
      // Issue #129 / North Star §4.3 / Audit G-C — the per-iter recall seam.
      // Fires EXACTLY ONCE per iter at iter-start, AFTER the snapshot emit and
      // BEFORE the think phase dispatches (so Phase 2 consumers can thread
      // results into the model prompt). Uses `Effect.serviceOption` so the
      // kernel works with no RecallService layer provided (returns None →
      // empty locals). Plain `yield*` (NOT `forkDaemon` like Learn) because
      // recall PRODUCES values consumed in-iter — forking would leave the
      // per-iter locals empty in the main loop.
      //
      // Wire-spot rationale: chosen here (between iter-snapshot and the
      // `before think` phase hooks) so recall fires for EVERY iter — even
      // ones a `before think` hook aborts. Phase 1 stores results in
      // per-iter LOCALS (not KernelState); Phase 2 decides persistence
      // shape after the migration of upstream recall (engine/bootstrap)
      // through this seam.
      let iterRecallContext: MemoryRecallResult = {
        semanticContext: "",
        episodic: [],
      };
      let iterRecallSkills: readonly FoundSkill[] = [];
      {
        const recallOpt = yield* Effect.serviceOption(RecallService);
        if (recallOpt._tag === "Some") {
          iterRecallContext = yield* recallOpt.value.recallMemoryContext(
            state,
            undefined,
          );
          iterRecallSkills = yield* recallOpt.value.findSkills(
            state,
            undefined,
          );
        }
      }
      // Phase 1 leaves iterRecallContext / iterRecallSkills unused beyond
      // capture — strategies still consume `input.priorContext` /
      // `input.briefResolvedSkills` as today. Phase 2 (runtime-warden) will
      // either merge these into the prompt directly or expose via a new
      // KernelState field once the upstream `engine/bootstrap` recall is
      // migrated through this seam.
      void iterRecallContext;
      void iterRecallSkills;

      const kernelPhaseStart = Date.now();
      yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });

      // 'before think' hooks — may abort iteration
      const beforeThinkAbort = yield* Effect.promise(() =>
        runPhaseHooks(effectiveInput.harnessPipeline, 'before', 'think', state.iteration, state)
      );
      if (beforeThinkAbort) {
        state = transitionState(state, {
          status: beforeThinkAbort.abort === 'terminate' ? 'failed' : 'done',
          output: state.output ?? '',
          meta: {
            ...state.meta,
            terminatedBy: killswitchTerminatedBy(beforeThinkAbort),
          },
        });
        sync(); return "break";
      }

      state = yield* kernel(state, currentContext);

      // 'after think' hooks
      yield* Effect.promise(() =>
        runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'think', state.iteration, state)
      );

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
          sync(); return "break";
        }
      }

      // ── Auto-checkpoint before context pressure gate ────────────────────
      // When approaching the hard pressure gate (within 5%), auto-save best
      // observations to the checkpoint store so they survive compaction.
      if (
        !autoCheckpointed &&
        shouldAutoCheckpoint({
          estimatedTokens: state.tokens,
          maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
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
        state, services, eventBus, prevStepCount, currentOptions, effectiveInput.harnessPipeline,
      ));

      // Honor early-stop dispatched by the intervention dispatcher.
      // Sprint 3.3 — flow through the Arbitrator so the veto can convert
      // a "framework giving up because of approaching maxIterations"
      // early-stop into status:failed when there's tool-failure evidence.
      if (state.meta.terminatedBy === "dispatcher-early-stop") {
        const arbCtx = arbitrationContextFromState(state, {
          task: input.task,
          requiredTools: input.requiredTools,
        });
        // WS-3 Phase 5b — emit BudgetSignal + arbitrate in a single call
        // colocated at the Decide capability boundary (invariant 10).
        state = yield* arbitrateAndApplyWithBudgetEmit({
          state,
          intent: {
            kind: "controller-early-stop",
            output: state.output ?? "",
            reason: "dispatcher_early_stop",
          },
          ctx: arbCtx,
          taskId: effectiveInput.taskId ?? "",
        });
        sync(); return "break";
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
          const switchResult = yield* applyStrategySwitch({
            state,
            currentInput,
            context,
            options,
            hooks,
            triedStrategies,
            switchCount,
            fromStrategy,
            toStrategy: pending.to,
            failureReason: pending.reason,
          });
          state = switchResult.state;
          currentInput = switchResult.currentInput;
          currentContext = switchResult.currentContext;
          currentOptions = switchResult.currentOptions;
          switchCount = switchResult.switchCount;
          ({
            prevActionCount,
            requiredToolRedirects,
            consecutiveStalled,
            prevArtifactCount,
            failureRecoveryRedirects,
          } = switchResult.resetCounters);
          sync(); return "continue";
        }
        // Switching not enabled or exhausted — deliver what we have
        state = terminate(state, {
          reason: "switching_exhausted",
          output: state.output ?? "",
        });
        sync(); return "break";
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
              const d = assembleDeliverable(state);
              state = terminate(state, {
                reason: deliverableTerminationReason(d),
                output: d.content,
              });
              sync(); return "break";
            }
            state = transitionState(state, {
              status: "failed",
              error: `Required tool quota not met after ${maxRequiredToolNudges} nudge attempts: ${missingRequiredByCount.join(", ")}`,
            });
            sync(); return "break";
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
          sync(); return "continue";
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
          sync(); return "continue";
        }

        if (totalArtifacts > 0) {
          // Verifier-driven retry on harness fallback (Pivot A, 2026-05-06).
          //
          // Pre-fix: the harness assembled raw `_tool_result_*` artifacts and
          // shipped them as the final answer. The verifier never saw the
          // output (loop broke before §9.0 ran), so quality-degraded JSON
          // dumps silently passed to the user. Empirical evidence: cogito:14b
          // T5 trace 01KQZFHFQA97RHHCNXQ792VWNQ — verified=true on a raw
          // JSON dump rated 7% faithfulness by the quality scorer.
          //
          // Post-fix: run the verifier on the candidate harness output with
          // terminatedBy="harness_deliverable" so the new
          // `output-is-model-authored` check rejects it. If retry budget
          // allows, inject the verdict-driven signal and continue thinking
          // — the model gets one more chance to synthesize from the
          // artifacts before the harness ships them as-is. If retry budget
          // is exhausted (or verifier passes — should be impossible with
          // the new check), fall through to the original terminate path.
          const candidateDeliverable = assembleDeliverable(state);
          const candidateOutput = candidateDeliverable.content;
          const candidateTerminationReason = deliverableTerminationReason(candidateDeliverable);
          const availableUserToolsForFallback =
            (currentInput.availableToolSchemas ?? []).map((t) => t.name);
          // M3 REWORK (2026-05-12): the retry path was removed, so the
          // verdict isn't consumed here — we just need the emit so the
          // outer post-loop §9.0 gate can read the trace. WS-3 Phase 5a
          // routes the emit through the verify capability boundary.
          yield* verifyAndEmit({
            verifier,
            context: {
              action: "final-answer",
              content: candidateOutput,
              actionSuccess: true,
              task: currentInput.task,
              priorSteps: state.steps,
              requiredTools: currentInput.requiredTools,
              relevantTools: currentInput.relevantTools,
              toolsUsed: state.toolsUsed,
              availableUserTools: availableUserToolsForFallback,
              terminal: true,
              terminatedBy: candidateTerminationReason,
            },
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
          });
          // M3 REWORK (2026-05-12): retry loop removed per ablation verdict.
          // Verifier gate still fires (emitted above); rejection falls through
          // to the §9.0 post-loop outer gate which marks the run failed.
          // Proceed with original
          // harness fallback. terminate() preserves the single-owner invariant.
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Assembling output from ${totalArtifacts} tool artifacts after ${consecutiveStalled} stalled iterations (source=${candidateDeliverable.source})`, timestamp: new Date() });
          state = terminate(state, {
            reason: candidateTerminationReason,
            output: candidateOutput,
          });
          sync(); return "break";
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
          // Stage 1: inject mandatory oracle guidance, increment count.
          //
          // The nudge text is composed by the Layer 1 intelligent default
          // builder `buildOracleNudge` (Spec: 2026-05-06-intelligent-default-builders).
          // The builder owns the M3 Pivot B "describe vs emit" example
          // pair and the final-attempt escalation footer.
          const nudgeLimit = (TIER_GUARD_THRESHOLDS[profile.tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).oracleNudgeLimit;
          const mandatoryNudge = buildOracleNudge({
            nudgeCount,
            nudgeLimit,
          });
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
              const switchResult = yield* applyStrategySwitch({
                state,
                currentInput,
                context,
                options,
                hooks,
                triedStrategies,
                switchCount,
                fromStrategy,
                toStrategy: evaluation.recommendedStrategy,
                failureReason: loopMsg,
              });
              state = switchResult.state;
              currentInput = switchResult.currentInput;
              currentContext = switchResult.currentContext;
              currentOptions = switchResult.currentOptions;
              switchCount = switchResult.switchCount;
              ({
                prevActionCount,
                requiredToolRedirects,
                consecutiveStalled,
                prevArtifactCount,
                failureRecoveryRedirects,
              } = switchResult.resetCounters);

              // Continue the outer while loop with fresh state
              sync(); return "continue";
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
            sync(); return "continue";
          }

          const loopArtifactCount = countDeliverableCandidates(state);
          if (loopArtifactCount > 0) {
            const missingRequiredByCount = missingRequiredToolsForInput(state.steps, currentInput);
            if (missingRequiredByCount.length > 0) {
              requiredToolNudgeCount++;
              if (requiredToolNudgeCount > maxRequiredToolNudges) {
                yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted in loop detection (${maxRequiredToolNudges}) — delivering ${loopArtifactCount} artifacts`, timestamp: new Date() });
                const d = assembleDeliverable(state);
                state = terminate(state, {
                  reason: deliverableTerminationReason(d),
                  output: d.content,
                });
                sync(); return "break";
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
              sync(); return "continue";
            }

            const loopDeliverable = assembleDeliverable(state);
            yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Loop detected but ${loopArtifactCount} artifacts gathered — delivering instead of failing (source=${loopDeliverable.source})`, timestamp: new Date() });
            state = terminate(state, {
              reason: deliverableTerminationReason(loopDeliverable),
              output: loopDeliverable.content,
            });
            sync(); return "break";
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
          sync(); return "break";
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
            sync(); return "break";
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

      // ── Learn capability — per-iter LearningPipeline write ───────────────
      // Issue #120 / North Star §4.3 / Audit G-D — the compounding-intelligence
      // seam. Fires EXACTLY ONCE per iter, after Verify/post-iteration finalize
      // and BEFORE the next iter dispatches. Uses `Effect.serviceOption` so the
      // kernel works with no LearningPipeline layer provided (returns None →
      // no-op). Wrapped in `Effect.forkDaemon` so user-supplied slow writers
      // (SkillStore disk flush, MemoryStore vector write) cannot block the
      // kernel hot path. Errors are swallowed by the service contract
      // (Effect<void, never> in learning-pipeline.ts).
      //
      // Args follow mission-brief decisions a–c:
      //   observations = ReasoningSteps appended during THIS iter only
      //   decisions    = controllerDecisionLog ADDITIONS this iter
      //   outcome      = mid-loop snapshot (success only authoritative on
      //                  the terminal iter — see learning-pipeline.ts JSDoc)
      {
        const learnOpt = yield* Effect.serviceOption(LearningPipeline);
        if (learnOpt._tag === "Some") {
          const newObservations = state.steps.slice(prevStepCountForLearn);
          const newDecisions = state.controllerDecisionLog.slice(prevDecisionLogCountForLearn);
          const outcomeSnapshot = {
            success: state.status === "done",
            output: state.output ?? undefined,
            tokensUsed: state.tokens,
            costUsd: state.cost,
          } as const;
          yield* Effect.forkDaemon(
            learnOpt.value.write(newObservations, newDecisions, outcomeSnapshot),
          );
          prevStepCountForLearn = state.steps.length;
          prevDecisionLogCountForLearn = state.controllerDecisionLog.length;
        }
      }

    // Body fall-through — outer while loop should re-evaluate and call us again.
    sync();
    return "continue";
  });
}
