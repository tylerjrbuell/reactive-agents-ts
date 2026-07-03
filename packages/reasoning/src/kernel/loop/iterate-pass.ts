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
 * Driver spine + cohesive phase-step helpers + immutable cfg + control-signal.
 *   - `runIterationPass` is the DRIVER: it runs the spine (pause-checkpoint →
 *     recall → before-think hooks → think → token-delta guard → auto-checkpoint
 *     → reactive-observer → dispatcher early-stop/switch → progress → lane →
 *     stall → ICS → oracle gate → loop-detection → required-tools guard →
 *     post-iter snapshot → learn) and delegates the three highest-coupling
 *     blocks to named phase-step helpers under `runner-helpers/`:
 *       · `applyStrategySwitch`     — reinit for a new strategy + reset counters
 *                                     (shared by dispatcher + loop-detector switch).
 *       · `runStallDeliverableStep` — harness stall / deliverable decision tree.
 *       · `resolveDetectedLoop`     — confirmed-loop recovery / deliver / fail tree.
 *     Each helper threads IMMUTABLE state through (takes state, returns the new
 *     state) and surfaces the specific counters it mutates as explicit in/out
 *     params — no carrier reaches the helpers.
 *   - `IterationConfig`: immutable per-run inputs (kernel, hooks, services,
 *     profile, verifier, etc.).
 *   - `IterationCarrier`: a MUTABLE holder for the spine locals that survive
 *     across iterations (counters, currentInput/Options/Context, switchCount,
 *     triedStrategies, mutableScratchpad) or are read by post-loop code. The
 *     driver destructures it into locals at entry and `sync()`s them back before
 *     each return. CORRECTION 5 reduced — NOT removed — the carrier: the three
 *     extracted phase-steps no longer touch it, but the spine still threads its
 *     locals through `sync()`. Dissolving it fully would require changing the
 *     runner.ts boundary (the hottest code path) and is deferred (see follow-up).
 *   - Return `"continue"` | `"break"` — outer while honors the signal.
 *
 * INVARIANTS PRESERVED (do not violate)
 * -------------------------------------
 *   1. Single-owner termination: `terminate(state, ...)` is the only writer
 *      of state.status to "done"/"failed" outside `kernel-state.ts` — true in
 *      the driver AND every extracted helper. No new state.status writers.
 *   2. transitionState() discipline: every state mutation routes through
 *      `transitionState(state, patch)`. ESLint enforces.
 *   3. Loop-detector streak rule (`detectLoop` at IC-1): only ACTION steps
 *      reset `maxConsecutiveThoughts`. Observations do NOT. The `detectLoop()`
 *      call stays in the driver spine; resolution moved to `resolveDetectedLoop`.
 *   4. No LLM re-verify (M3 REWORK precedent): the verifier emit in the stall
 *      step is emit-only — no retry; the post-loop §9.0 gate is the sole
 *      consumer of rejection.
 *   5. Phase-chain ordering (sense → attend → comprehend → recall → reason →
 *      decide → act → verify → reflect → learn) is preserved by the driver's
 *      fixed call order; extracting a block doesn't change where it runs.
 *
 * HISTORY
 * -------
 *   - WS-6 Phase 2 (2026-05-28): runner.ts 1976 → 1615 via four helper buckets
 *     (tier-guards, deliverable, recovery-steering, state-queries) under
 *     `runner-helpers/`. Phase 2 UpwardReport flagged iteration-block lift as
 *     the highest-leverage remaining reduction.
 *   - WS-6 Phase 4 (2026-05-29): iteration body lifted whole into this file via
 *     a mechanical carrier/sync scaffold (relocation, not decomposition).
 *   - WS-6 CORRECTION 5 (2026-05-29): replaced the scaffold's LOC-theater with
 *     real cohesion — extracted the three F2-named coupling blocks (strategy
 *     switch, stall/deliverable, loop resolution) into named phase-steps with
 *     immutable state threading + explicit counter params. Carrier reduced.
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md §3 line 468 + §5.5a.
 */
import { Effect, FiberRef } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { checkpointStoreRef } from "@reactive-agents/tools";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import type { ContextProfile } from "../../context/context-profile.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { terminate } from "./terminate.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import { serializeKernelState } from "../state/kernel-codec.js";
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
import { runStallDeliverableStep } from "./runner-helpers/stall-deliverable.js";
import { resolveDetectedLoop } from "./runner-helpers/loop-resolution.js";
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
import { type Verifier } from "../../kernel/capabilities/verify/verifier.js";
import { LearningPipeline } from "../../kernel/capabilities/learn/learning-pipeline.js";
import {
  RecallService,
  type MemoryRecallResult,
  type FoundSkill,
} from "../../kernel/capabilities/recall/recall-service.js";
import {
  emitKernelStateSnapshot,
  emitGuardFired,
  emitHarnessSignalInjected,
} from "../../kernel/utils/diagnostics.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
  detectRepeatedIdenticalToolFailure,
} from "./runner-helpers/recovery-steering.js";
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
  countDeliverableCandidates,
  buildEffectiveToolsUsed,
  commitDeliverable,
  passthroughOutputDeliverable,
} from "./runner-helpers/deliverable.js";

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
 * Run one iteration of the kernel main loop — the DRIVER spine.
 *
 * Destructures the mutable {@link IterationCarrier} into spine locals at entry,
 * runs the phase chain in fixed order (see SHAPE in the file header), delegates
 * the three high-coupling blocks to `applyStrategySwitch` /
 * `runStallDeliverableStep` / `resolveDetectedLoop`, and `sync()`s the locals
 * back to the carrier before every return.
 *
 * Returns the outer-loop control signal:
 *   - `"break"`    — this iteration terminated (delivered or failed); exit loop.
 *   - `"continue"` — re-run the loop body (an explicit short-circuit OR the
 *                    body fall-through at the end of a normal iteration).
 *
 * The extracted phase-steps thread immutable state through and take/return only
 * the specific counters they own; the carrier never reaches them. The spine
 * itself still uses the carrier/`sync()` mechanism for its remaining locals.
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
          // Sprint-1 B2 / P1 mission 2B: typed DeliverableProvenance channel.
          // Stop-checkpoint is a user-initiated termination — route through the
          // single-owner terminate() (status/terminatedBy) which delegates the
          // output string to commitDeliverable. Preserve any prior committed
          // output as a passthrough; an empty output becomes a structured
          // sentinel (NOT a raw empty string).
          state = terminate(state, {
            reason: "stop_requested",
            deliverable: passthroughOutputDeliverable(state.output),
          });
          sync(); return "break";
        }
        // Durable-execution seam (v0.12.0 track 1): surface the iteration-boundary
        // state to an optional durable controller. Observer must NEVER kill the
        // loop — failures are warn-surfaced (R11 precedent), not propagated.
        if (_runCtl.onCheckpoint) {
          try {
            _runCtl.onCheckpoint(serializeKernelState(state), state.iteration);
          } catch (err) {
            const msg = `[durable-checkpoint] onCheckpoint observer threw at iteration ${state.iteration}: ${err instanceof Error ? err.message : String(err)}`;
            yield* Effect.logWarning(msg);
          }
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
      // F1/F3 pass-start markers (2026-07-02): step count before the kernel
      // phase runs (so F3 fires only on failures appended THIS pass, never on a
      // stale streak) and the grounding-redirect counter before the Arbitrator
      // could bump it (so the F1 redirect emits exactly one trace event).
      const stepsAtPassStart = state.steps.length;
      const groundingRedirectsAtPassStart = state.meta.groundingRedirectCount ?? 0;
      yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });

      // 'before think' hooks — may abort iteration
      const beforeThinkAbort = yield* Effect.promise(() =>
        runPhaseHooks(effectiveInput.harnessPipeline, 'before', 'think', state.iteration, state)
      );
      if (beforeThinkAbort) {
        // P1 mission 2B: killswitch abort carries a DYNAMIC terminatedBy (not a
        // TerminateReason), so it can't route through terminate(). Set
        // status + terminatedBy via transitionState (NO output key), then —
        // only on the successful "done" branch — route the output string
        // through the single writer commitDeliverable. The "failed" branch
        // drops the key so the transitionState invariant nulls the output.
        const aborted = beforeThinkAbort.abort === 'terminate';
        state = transitionState(state, {
          status: aborted ? 'failed' : 'done',
          meta: {
            ...state.meta,
            terminatedBy: killswitchTerminatedBy(beforeThinkAbort),
          },
        });
        if (!aborted) {
          state = commitDeliverable(state, passthroughOutputDeliverable(state.output));
        }
        sync(); return "break";
      }

      state = yield* kernel(state, currentContext);

      // Durable HITL (Phase D): when the act gate paused the run, checkpoint the
      // PAUSED state NOW — the per-iteration onCheckpoint above fires at the pass
      // BOUNDARY (before think/act), so it never captures the post-gate state that
      // carries `meta.awaitingApprovalFor` + the pending call. Without this, resume
      // restores a pre-gate checkpoint, the runner re-entry finds no
      // `awaitingApprovalFor`, and the gate re-fires instead of executing the
      // approved call. Fire-and-forget through the same observer contract (never
      // kills the loop). The loop exits immediately after (status:"done").
      // Durable pause (Task 9): a `request_user_input` interaction pause needs
      // the identical post-gate checkpoint — same rationale, mirrors
      // `meta.awaitingInteractionFor` instead of `awaitingApprovalFor`.
      if (
        (state.meta.terminatedBy === "awaiting-approval" ||
          state.meta.terminatedBy === "awaiting-interaction") &&
        _runCtl?.onCheckpoint
      ) {
        try {
          // Write at iteration+1 so this is a DISTINCT row that always wins
          // `latestCheckpoint` (ORDER BY iteration DESC) — the pass-boundary
          // checkpoint above writes the pre-gate state at this same iteration, and
          // both go through fire-and-forget `Effect.runFork`, so a same-iteration
          // write would race. The stateJson keeps its real iteration; the column
          // is only an ordering key. Resume reads the stateJson, not the column.
          _runCtl.onCheckpoint(serializeKernelState(state), state.iteration + 1);
        } catch (err) {
          yield* Effect.logWarning(
            `[durable-checkpoint] paused-state onCheckpoint threw at iteration ${state.iteration}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

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

      // ── F1 — grounded-terminal redirect trace (2026-07-02) ───────────────
      // The Arbitrator's grounded-terminal gate is pure (it appends the
      // harness_signal step and bumps meta.groundingRedirectCount inside
      // applyTermination); the runner owns the diagnostics emission. A bump
      // during this pass means the gate rejected an ungrounded terminal —
      // surface it on the same harness-signal-injected trace path the
      // stall/loop recovery redirects use, so rax:diagnose sees it.
      if ((state.meta.groundingRedirectCount ?? 0) > groundingRedirectsAtPassStart) {
        const redirectSignal = [...state.steps]
          .reverse()
          .find((s) => s.type === "harness_signal");
        yield* emitHarnessSignalInjected({
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
          signalKind: "redirect",
          origin: "capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate",
          content: redirectSignal?.content ?? "grounded-terminal redirect",
          metadata: {
            trigger: "grounded-terminal",
            groundingRedirectCount: state.meta.groundingRedirectCount,
            requiredTools: currentInput.requiredTools ?? [],
          },
        });
        // The redirect IS this pass's steering — short-circuit to the next
        // iteration (same "next" pattern as the stall/loop recovery paths) so
        // the stall guard cannot stack a SECOND recovery signal onto the same
        // pass and the run stays capped at ONE grounding redirect end-to-end.
        sync(); return "continue";
      }

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
          yield* emitGuardFired({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            guard: "low_delta_guard",
            outcome: "terminate",
            reason: "low_delta",
            metadata: {
              tokenDelta,
              consecutiveLowDeltaCount: newConsecutiveLowDelta,
              artifactsAvailable: countDeliverableCandidates(state),
            },
          });
          state = terminate(state, {
            reason: "low_delta_guard",
            deliverable: passthroughOutputDeliverable(state.output),
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
        state, services, eventBus, prevStepCount, currentOptions, profile.tier, effectiveInput.harnessPipeline,
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
          deliverable: passthroughOutputDeliverable(state.output),
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

      // ── F3 — repeated-identical-failure escalation (2026-07-02) ──────────
      // Bench root cause (cogito:8b rw-8): the model repeated the SAME
      // malformed call 4×, got 4 identical errors, then shipped a guess.
      // Recovery steering existed but only fired via the stall (iter ≥ 2) or
      // loop guards — several wasted iterations later. Here: same tool + same
      // normalized error class ≥2 consecutive failures → inject the SAME
      // recovery steering immediately. Guards:
      //   - the trailing failure landed THIS pass (no re-fire on a stale streak),
      //   - the tool is a real registered tool (never pseudo-observations like
      //     "system"/"completion-guard" guard feedback),
      //   - shared redirect budget (failureRecoveryRedirects) not exhausted,
      //   - run still live (a terminal reached this pass is never reopened).
      if (state.status !== "done" && state.status !== "failed") {
        const repeated = detectRepeatedIdenticalToolFailure(state.steps);
        const knownToolNames = new Set(
          (currentInput.availableToolSchemas ?? []).map((t) => t.name),
        );
        if (
          repeated !== null &&
          repeated.lastIndex >= stepsAtPassStart &&
          knownToolNames.has(repeated.toolName) &&
          failureRecoveryRedirects < maxFailureRecoveryRedirects
        ) {
          const repeatedRecovery = getToolFailureRecovery(state, currentInput);
          if (repeatedRecovery.failedUnresolved.length > 0) {
            failureRecoveryRedirects++;
            const guidance = buildRecoverySteeringGuidance(
              repeatedRecovery,
              failureRecoveryRedirects,
              maxFailureRecoveryRedirects,
              "stall",
            );
            yield* emitHarnessSignalInjected({
              taskId: currentOptions.taskId ?? state.taskId,
              iteration: state.iteration,
              signalKind: "redirect",
              origin: "loop/iterate-pass.ts:710:repeated-identical-failure",
              content: guidance,
              metadata: {
                trigger: "repeated-identical-failure",
                toolName: repeated.toolName,
                errorClass: repeated.errorClass,
                streak: repeated.streak,
                redirectCount: failureRecoveryRedirects,
              },
            });
            state = transitionState(state, {
              status: "thinking",
              steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
              pendingGuidance: {
                ...(state.pendingGuidance ?? {}),
                errorRecovery: guidance,
              },
              error: null,
            });
            sync(); return "continue";
          }
        }
      }

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

      const stallTriggered =
        consecutiveStalled >= stallThreshold &&
        state.iteration >= 2 &&
        state.status === "thinking";
      {
        const stallResult = yield* runStallDeliverableStep({
          state,
          currentInput,
          currentOptions,
          missingRequiredByCount: laneDecision.missingRequiredTools,
          stallTriggered,
          totalArtifacts,
          consecutiveStalled,
          requiredToolNudgeCount,
          failureRecoveryRedirects,
          maxRequiredToolNudges,
          maxFailureRecoveryRedirects,
          verifier,
          emitLog,
        });
        state = stallResult.state;
        requiredToolNudgeCount = stallResult.requiredToolNudgeCount;
        failureRecoveryRedirects = stallResult.failureRecoveryRedirects;
        if (stallResult.outcome === "break") { sync(); return "break"; }
        if (stallResult.outcome === "next") { sync(); return "continue"; }
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
          yield* emitGuardFired({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            guard: "oracle_forced",
            outcome: "terminate",
            reason: "oracle_forced",
            metadata: {
              nudgeCount,
              willDeliver: !!(
                state.output ??
                state.steps.filter((s) => s.type === "thought").slice(-1)[0]?.content
              )?.trim(),
            },
          });
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
              // oracleForcedOutput is state.output (already committed model text)
              // or the last substantive thought — model-authored → model_synthesis.
              deliverable: modelSynthesisDeliverable({
                type: "thought",
                content: oracleForcedOutput,
                iteration: state.iteration,
              }),
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

          // No switch taken (disabled / exhausted / evaluator declined) — resolve
          // the confirmed loop via the recovery / deliver / fail tree. Always
          // ends in break or continue; never proceeds to the rest of the body.
          const loopResult = yield* resolveDetectedLoop({
            state,
            currentInput,
            currentOptions,
            loopMsg,
            failureRecoveryRedirects,
            requiredToolNudgeCount,
            maxFailureRecoveryRedirects,
            maxRequiredToolNudges,
            emitLog,
          });
          state = loopResult.state;
          failureRecoveryRedirects = loopResult.failureRecoveryRedirects;
          requiredToolNudgeCount = loopResult.requiredToolNudgeCount;
          sync();
          return loopResult.outcome === "break" ? "break" : "continue";
        }
      } // end if (state.status !== "done" && state.status !== "failed")

      // ── Required tools guard (in-loop) ─────────────────────────────────
      // When the kernel declares "done" but required tools haven't been called,
      // redirect back to "thinking" with a feedback step — up to the retry limit.
      //
      // Durable HITL (Phase D): an `awaiting-approval` pause is NOT a missing
      // required tool — the gated tool WAS requested and the run is intentionally
      // suspended before executing it. Without this exemption the auto-required-
      // tools redirect re-thinks the gated call every iteration (the gate re-fires,
      // the tool never "executes") and the run loops to max_iterations instead of
      // pausing. Resume executes the approved call, satisfying the requirement.
      // Durable pause (Task 9): an `awaiting-interaction` pause is the identical
      // case — the model asked for human input via `request_user_input` and the
      // run is intentionally suspended, not missing a required tool.
      if (
        state.status === "done" &&
        requiredTools.length > 0 &&
        state.meta.terminatedBy !== "awaiting-approval" &&
        state.meta.terminatedBy !== "awaiting-interaction"
      ) {
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
