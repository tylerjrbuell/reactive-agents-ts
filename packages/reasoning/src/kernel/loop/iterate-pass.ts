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
 *     driver destructures it into locals at entry; the iteration BODY then runs
 *     as an inner generator that returns the control signal, and the driver
 *     writes the locals back to the carrier EXACTLY ONCE after that inner effect
 *     settles (W4.0 single-writer). There is no per-return `sync()` to forget:
 *     every body exit path returns through the one unconditional write-back.
 *     Dissolving the carrier fully would require changing the runner.ts boundary
 *     (the hottest code path), which reads `carrier.*` after each pass, so it is
 *     deferred.
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
 *   - W4.0 (2026-10-13): single-writer refactor. The 18 manual per-return
 *     `sync()` call sites + the `sync` closure were replaced by a generator
 *     return-protocol: the body is one inner `Effect.gen` returning
 *     `IterationSignal`, and the carrier write-back happens exactly once, after
 *     it settles (unconditional — the inner effect's error channel is `never`).
 *     "Forgot to sync" is now unrepresentable. Behavior byte-identical.
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md §3 line 468 + §5.5a.
 */
import { Effect, FiberRef } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { modelSynthesisDeliverable, sentinelDeliverable } from "@reactive-agents/core";
import type { ContextProfile } from "../../context/context-profile.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { terminate } from "./terminate.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import { authorityOf } from "../../kernel/capabilities/decide/authority.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
  type KernelHooks,
} from "../../kernel/state/kernel-state.js";
import { applyStrategySwitch } from "./runner-helpers/strategy-switch.js";
import { openSignal } from "../state/signal-ledger.js";
import { runStallDeliverableStep } from "./runner-helpers/stall-deliverable.js";
import type { HorizonProfile } from "./runner-helpers/horizon-profile.js";
import {
  assessmentFailuresAreArgVarying,
  assessmentIsGatheringPhase,
  nextLowDeltaCount,
  nextStalledCount,
} from "../../kernel/assessment/guard-adapters.js";
import { resolveDetectedLoop } from "./runner-helpers/loop-resolution.js";
import { runReactiveObserver } from "../../kernel/capabilities/reflect/reactive-observer.js";
import { runPhaseHooks } from "./phase-hooks.js";
import { detectLoopPattern, checkAllToolsCalled } from "../../kernel/capabilities/reflect/loop-detector.js";
import { buildOracleNudge } from "../../kernel/capabilities/decide/oracle-nudge.js";
import { shouldInjectOracleNudge } from "../../kernel/utils/lane-controller.js";
import { type Verifier } from "../../kernel/capabilities/verify/verifier.js";
import {
  emitKernelStateSnapshot,
  emitGuardFired,
  emitHarnessSignalInjected,
} from "../../kernel/utils/diagnostics.js";
import { recompileOnAssessment } from "../../kernel/policy/harness-plan.js";
import { recordHarnessRecompiled } from "../../kernel/ledger/emit.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
  detectRepeatedIdenticalToolFailure,
} from "./runner-helpers/recovery-steering.js";
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
} from "./runner-helpers/state-queries.js";
import {
  countDeliverableCandidates,
  buildEffectiveToolsUsed,
  passthroughOutputDeliverable,
  unproducedDeliverables,
} from "./runner-helpers/deliverable.js";
// Task 9 (2026-10-23) — verbatim cluster extractions (quality program / GH #222).
// Every script-anchored region stayed inline: the carrier/cfg interfaces + the
// spine counter locals (check-run-assessment grandfather), the
// recompileOnAssessment block (check-policy-compiler), both applyStrategySwitch
// seams (check-control-plane), all terminate() routing (check-termination-paths),
// the token-delta guard + F1 redirect trace + stall-count tracking + oracle gate
// + loop-resolution + required-tools redirect (counter writes), and the
// W4.0 single-writer carrier write-back.
import { runPassBoundaryCheckpoint, runPostPhaseCheckpointSeams } from "./iterate-run-ctl-checkpoint.js";
import {
  assessAndRecordPass,
  zeroEvidenceStandDownReason,
  applyE3PaceActions,
} from "./iterate-assessment-seam.js";
import { runPerIterRecall } from "./iterate-recall-seam.js";
import { runBeforeThinkHooks } from "./iterate-before-think-seam.js";
import { handleDispatcherEarlyStop } from "./iterate-early-stop-seam.js";
import {
  resolveF3ControlPlane,
  resolveStallControlPlane,
  resolveSwitchControlPlane,
} from "./iterate-control-plane-seams.js";
import { resolveLoopSwitchEvaluation } from "./iterate-loop-switch-seam.js";
import {
  runAutoCheckpointStep,
  applyExecutionLane,
  runIcsNudgeStep,
} from "./iterate-guard-seams.js";
import { forkIterLearnWrite } from "./iterate-learn-seam.js";

// W4-live evidence-staleness threshold const now lives in
// ./iterate-assessment-seam.ts (Task 9 extraction; single definition).
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
 * carrier. The write-back happens ONCE per pass — after the inner body effect
 * settles — so every exit path (each `"break"` / `"continue"`) observes the
 * same up-to-date values. Keeps the call site in runner.ts tiny:
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
  /**
   * A2 — resolved long-horizon guard scaling, or `undefined` when the profile
   * is off. When present, the stall threshold + oracle nudge limit scale with
   * `maxIterations`; when absent every read below keeps its literal.
   */
  horizon?: HorizonProfile;
}

/**
 * Run one iteration of the kernel main loop — the DRIVER spine.
 *
 * Destructures the mutable {@link IterationCarrier} into spine locals at entry,
 * runs the phase chain in fixed order (see SHAPE in the file header) as a single
 * inner generator that returns the control signal, delegates the three
 * high-coupling blocks to `applyStrategySwitch` / `runStallDeliverableStep` /
 * `resolveDetectedLoop`, and writes the locals back to the carrier EXACTLY ONCE
 * after that inner effect settles (W4.0 single-writer).
 *
 * Returns the outer-loop control signal:
 *   - `"break"`    — this iteration terminated (delivered or failed); exit loop.
 *   - `"continue"` — re-run the loop body (an explicit short-circuit OR the
 *                    body fall-through at the end of a normal iteration).
 *
 * The extracted phase-steps thread immutable state through and take/return only
 * the specific counters they own; the carrier never reaches them. The body's
 * own `return` sites are the inner generator's natural exits — no `sync()` is
 * paired with them (the single write-back below runs for all of them).
 */
export function runIterationPass(
  carrier: IterationCarrier,
  cfg: IterationConfig,
): Effect.Effect<IterationSignal, never, LLMService> {
  return Effect.gen(function* () {
    // ── Destructure mutable carrier into locals ─────────────────────────────
    // The body below references these as plain identifiers (matching the
    // pre-lift runner.ts identifiers exactly). The body is an inner generator
    // (below) that returns the control signal; the outer driver writes these
    // locals back to the carrier exactly once, after it settles, so the outer
    // while-loop and post-loop finalization see the latest values.
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
    // W4.1 (e) — evidence-staleness iterations, read from the current pass's
    // assessment (health.iterationsSinceEvidence). A local, not a carrier field:
    // it is recomputed from the ledger each pass, so multiple assessments per
    // iteration cannot over-count it.
    let evidenceStaleIterations = 0;
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
      horizon,
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
    void effectiveInput; void input; void emitLog; void eventBus; void horizon;

    // ── Iteration body — inner generator, returns the control signal ────────
    // W4.0 single-writer. The whole body runs as ONE inner Effect.gen that
    // closes over the spine locals above and RETURNS "break"/"continue" at each
    // exit. Its error channel is `never`, so the carrier write-back after it
    // runs exactly once, unconditionally, for every exit path. A new `return`
    // added anywhere in the body therefore auto-writes-back — there is no
    // `sync()` to forget (the pre-W4.0 shape paired a manual `sync()` with all
    // 18 return sites; a missed pairing silently stranded carrier mutations).
    const signal: IterationSignal = yield* Effect.gen(function* () {

    // ── ORIGINAL BODY (lifted from Phase 2 runner.ts lines 389-1285) ────────
      // Pause/stop checkpoint: awaits resume() if paused, returns { stop: true } on stop().
      const _runCtl = yield* FiberRef.get(RunControllerRef);
      if (_runCtl) {
        const passBoundary = yield* runPassBoundaryCheckpoint({ state, _runCtl });
        state = passBoundary.state;
        if (passBoundary.stopped) {
          return "break";
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

      // RunAssessment (meta-loop Phase 5a / task E1) — the perception node. The
      // ONE per-iteration site that recomputes where the run stands from
      // contract × ledger × budget, caches it on state.meta.assessment, and
      // emits the replayable `assessment` trace event. Pure READ (assess() never
      // mutates / appends): the transitionState below only writes meta.assessment,
      // carrying steps + ledger through unchanged — DAG-safe, no back-edge. Guarded
      // on a compiled RunContract (the goal input assess() needs). E2 migrates the
      // scattered guard counters to READ these fields (the D2 kill).
      {
        const contract = state.meta.runContract;
        if (contract) {
          const assessed = yield* assessAndRecordPass({ state, contract, currentOptions });
          state = assessed.state;
          const assessment = assessed.assessment;
          evidenceStaleIterations = assessed.evidenceStaleIterations;

          // ── W4-live: default-on zero-evidence stand-down ────────────────────
          // FLAIL discriminator decomposed verbatim to ./iterate-assessment-seam.ts
          // (quality Task 9); the honest-abstain terminate() route stays HERE —
          // single-owner termination (check-termination-paths) + the F1/P5
          // precedence rationale travel with the helper.
          const reason = zeroEvidenceStandDownReason({
            state, assessment, evidenceStaleIterations, requiredTools, horizon, currentOptions,
          });
          if (reason !== null) {
            state = terminate(state, {
              reason: "abstained",
              deliverable: sentinelDeliverable("no_substantive_output", reason),
              extraMeta: {
                abstention: { reason, missing: [] },
                // The output is a harness-authored sentinel, not a model answer:
                // mark it so resolveCompletionStatus does not report "completed"
                // for an abstention (honest partial at the strategy boundary; the
                // engine maps terminatedBy:"abstained" → failure regardless).
                harnessAuthoredOutput: true,
              },
            });
            return "break";
          }

          // ── HarnessPlan mid-run recompile (meta-loop Phase 6 / task G1) ──────
          // The adaptive lever: on a cadence, recompile the run's HarnessPlan from
          // the just-computed assessment — DEEPEN scaffolding when the run is
          // struggling (repeated failures / no new evidence), LEAN when it flows.
          // OPT-IN behind `.withAdaptiveHarness()`; OFF (default, no
          // `meta.harnessPlan`) → this whole block is skipped → byte-identical.
          // DAG-safe: a pure READ of the assessment (E1); the only writes are the
          // updated plan on meta + a logged `harness-signal` ledger entry. Bounded
          // by recompileOnAssessment (one step/call, scaffolding clamped) AND the
          // cadence gate below. Cadence 3 = responsive without recomputing the
          // plan every iteration (the assessment itself is already per-iteration).
          const HARNESS_RECOMPILE_CADENCE = 3;
          if (
            currentOptions.adaptiveHarness === true &&
            state.meta.harnessPlan &&
            state.iteration > 0 &&
            state.iteration % HARNESS_RECOMPILE_CADENCE === 0
          ) {
            const recompiled = recompileOnAssessment(state.meta.harnessPlan, assessment);
            if (recompiled.changed) {
              const ledgerWithSignal = recordHarnessRecompiled(
                state.ledger,
                state.iteration,
                recompiled.reason,
              );
              state = transitionState(state, {
                ledger: ledgerWithSignal,
                meta: {
                  ...state.meta,
                  harnessPlan: recompiled.plan,
                  // Escalate the live horizon profile when the recompile deepened
                  // it (read by the RI observer). Deescalation of the already-
                  // resolved guard bundle mid-run is out of scope — the leaner
                  // plan still stands on meta for downstream/receipt consumers.
                  ...(recompiled.plan.guard.horizonProfile
                    ? { horizonProfile: recompiled.plan.guard.horizonProfile }
                    : {}),
                },
              });
            }
          }

          // ── E3 pace ACTIONS — turn the just-computed pace band into actuator
          // actions. Decomposed verbatim to ./iterate-assessment-seam.ts
          // (quality program Task 9).
          const pace = yield* applyE3PaceActions({
            state, contract, assessment, currentInput, currentOptions, horizon, emitLog,
          });
          state = pace.state;
          if (pace.terminated) {
            return "break";
          }
        }
      }

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
      const { iterRecallContext, iterRecallSkills } = yield* runPerIterRecall({ state });
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

      // `kernel` is a STATUS-DISPATCHED transition (react-kernel.ts): it runs
      // the think capability on status "thinking" and the ACT capability on
      // status "acting". This pass therefore only owns the `think` phase when
      // it is about to dispatch a thinking step. Firing `think` hooks around
      // an acting dispatch reported every tool execution as a reasoning step:
      // user `think` hooks ran on tool calls, and a think-scoped killswitch
      // counted them, roughly doubling the observed think count. The act
      // dispatch fires its own `before`/`after` `act` hooks (with the same
      // abort semantics) inside act.ts, so it needs no wrapper here.
      const dispatchesThink = state.status === "thinking";

      if (dispatchesThink) {
        yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });
      }

      // 'before think' hooks — may abort iteration. Decomposed verbatim to
      // ./iterate-before-think-seam.ts (quality program Task 9).
      const beforeThink = yield* runBeforeThinkHooks({ state, effectiveInput, eventBus, dispatchesThink });
      state = beforeThink.state;
      if (beforeThink.aborted) {
        return "break";
      }

      state = yield* kernel(state, currentContext);

      // Live-inspection post-phase seam + durable HITL/interaction paused-state
      // checkpoint — decomposed verbatim to ./iterate-run-ctl-checkpoint.ts
      // (quality program Task 9).
      yield* runPostPhaseCheckpointSeams({ state, _runCtl });

      // 'after think' hooks — paired with the 'before' fire above, so they
      // only run when this pass actually dispatched a thinking step.
      if (dispatchesThink) {
        yield* Effect.promise(() =>
          runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'think', state.iteration, state)
        );

        yield* emitLog({
          _tag: "phase_complete",
          phase: "think",
          duration: Date.now() - kernelPhaseStart,
          status: state.status === "failed" ? "error" : "success",
        });
      }

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
        const signalContent = redirectSignal?.content ?? "grounded-terminal redirect";
        // Signal consumption edge (2026-10-25): open a ledger entry + pending
        // ref so the render/effect chain can track this steer.
        const opened = openSignal(state.signalLedger ?? [], {
          signalKind: "redirect",
          origin: "capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate",
          target: { policy: "synthesize" },
          iter: state.iteration,
          content: signalContent,
        });
        const priorRefs = state.pendingGuidance?.pendingSignals ?? [];
        state = transitionState(state, {
          signalLedger: opened.ledger,
          pendingGuidance: {
            ...(state.pendingGuidance ?? {}),
            errorRecovery: signalContent,
            pendingSignals: [...priorRefs, { signalId: opened.signalId, field: "errorRecovery", target: { policy: "synthesize" } }],
          },
        });
        const signalId = opened.signalId;
        yield* emitHarnessSignalInjected({
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
          signalKind: "redirect",
          origin: "capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate",
          content: signalContent,
          signalId,
          targetPolicy: "synthesize",
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
        return "continue";
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
        // E2 (audit 02-#3): a successful NEW gather is progress — token delta
        // alone is blind to tool successes. Under the long-horizon profile, a
        // low-delta iteration that produced new substantive evidence
        // (assessment.evidenceDelta > 0) does NOT accrue toward the exit; the
        // counter resets. OFF → byte-identical to the legacy expression.
        const newConsecutiveLowDelta = nextLowDeltaCount(
          state.consecutiveLowDeltaCount ?? 0,
          lowDelta,
          horizon !== undefined,
          state.meta.assessment,
        );
        state = transitionState(state, { consecutiveLowDeltaCount: newConsecutiveLowDelta });

        // Only fire the guard when there are remaining iterations to save
        // (if we're already at the last iteration, the loop exits naturally).
        const hasRemainingIterations = state.iteration < currentOptions.maxIterations - 1;
        const missingRequiredForLowDelta = missingRequiredToolsForInput(state.steps, currentInput);
        // A declared deliverable that has not been produced is the same class of
        // "the run is not done" fact as a required tool that has not been
        // called — and it is the one the RunContract exists to state. Nothing
        // consulted it, so this guard could end a run whose entire point was to
        // write a file it had not written: bench rw-4 (2026-07-26) fetched the
        // posts, fetched the comments and computed the enriched array, then was
        // terminated on tokenDelta 0 with artifactsAvailable 4, before writing
        // the required output.ts. maxIterations still bounds the run; this only
        // declines the EARLY exit while the contract is demonstrably unmet.
        const unproducedForLowDelta = unproducedDeliverables(state);
        if (
          hasRemainingIterations &&
          missingRequiredForLowDelta.length === 0 &&
          unproducedForLowDelta.length === 0 &&
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
          return "break";
        }
      }

      // ── Auto-checkpoint before context pressure gate ────────────────────
      // Decomposed verbatim to ./iterate-guard-seams.ts (quality Task 9).
      ({ autoCheckpointed } = yield* runAutoCheckpointStep({ state, profile, autoCheckpointed, emitLog }));

      // Sync scratchpad: kernel may have added entries
      for (const [k, v] of state.scratchpad) {
        mutableScratchpad.set(k, v);
      }

      // ── Entropy scoring + Reactive Controller evaluation ────────────────
      ({ state, prevStepCount } = yield* runReactiveObserver(
        state, services, eventBus, prevStepCount, currentOptions, profile.tier, effectiveInput.harnessPipeline,
        // RC-3 — the kernel's repeated-identical-failure redirect streak is the
        // single loop-stuck trigger authority. This observer runs BEFORE this
        // pass's F3 redirect block, so RI sees the count as of the kernel's last
        // committed redirect and can only escalate a stall the kernel already
        // acted on (previously both fired independently, one iteration apart).
        failureRecoveryRedirects,
      ));

      // ── Honor early-stop dispatched by the intervention dispatcher ────────
      // Decomposed verbatim to ./iterate-early-stop-seam.ts (quality Task 9):
      // one evidence-grace turn when unconsumed stored evidence exists (2026-08-16
      // root fix), else the Arbitrator veto honors the forced stop.
      if (state.meta.terminatedBy === "dispatcher-early-stop") {
        const earlyStop = yield* handleDispatcherEarlyStop({ state, input, effectiveInput });
        state = earlyStop.state;
        return earlyStop.signal;
      }

      // Apply temperature override dispatched by the intervention dispatcher
      if (typeof state.meta.dispatchedTemperature === "number") {
        currentOptions = {
          ...currentOptions,
          temperature: state.meta.dispatchedTemperature,
        };
      }

      // Honor dispatcher-requested strategy switch
      if (state.meta.terminatedBy === "dispatcher-strategy-switch") {
        const pending = state.meta.dispatchedStrategySwitch;
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
          return "continue";
        }
        // Switching not enabled or exhausted — deliver what we have
        state = terminate(state, {
          reason: "switching_exhausted",
          deliverable: passthroughOutputDeliverable(state.output),
        });
        return "break";
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
        // E2 (audit 02-#11): the F3 error class is arg-INSENSITIVE — it fires on
        // (tool, errorClass) alone, so a model VARYING its arguments across
        // failures (genuinely exploring fixes) gets the same immediate redirect
        // as one blindly repeating a single bad call. Under the long-horizon
        // profile, when the arg-normalized failure signal shows varying args
        // (assessment.health.failureArgVariety > 1) suppress the immediate F3
        // redirect and let the model keep searching. OFF → byte-identical.
        const f3ArgVarying = assessmentFailuresAreArgVarying(horizon !== undefined, state.meta.assessment);
        if (
          repeated !== null &&
          repeated.lastIndex >= stepsAtPassStart &&
          knownToolNames.has(repeated.toolName) &&
          failureRecoveryRedirects < maxFailureRecoveryRedirects &&
          !f3ArgVarying
        ) {
          const repeatedRecovery = getToolFailureRecovery(state, currentInput);
          if (repeatedRecovery.failedUnresolved.length > 0) {
            // The redirect this seam WANTS. Built before the control plane runs so
            // it can be offered as a proposal rather than forced; the counter is
            // only committed if the redirect actually wins (below).
            const prospectiveRedirects = failureRecoveryRedirects + 1;
            const guidance = buildRecoverySteeringGuidance(
              repeatedRecovery,
              prospectiveRedirects,
              maxFailureRecoveryRedirects,
              "stall",
            );

            if (horizon !== undefined) {
              // Control plane (F3 seam) — resolve redirect vs abstain. Decomposed
              // verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
              const f3Plane = yield* resolveF3ControlPlane({
                state,
                currentInput,
                requiredTools,
                currentOptions,
                horizon,
                repeated,
                repeatedRecovery,
                guidance,
              });
              state = f3Plane.state;
              if (f3Plane.abstained) {
                return "break";
              }
            }

            failureRecoveryRedirects++;
            const recoveryTargetPolicy =
              (repeatedRecovery?.alternativeCandidates?.length ?? 0) > 0
                ? ("alternate-tool" as const)
                : ("denied-tool-retry" as const);
            const recoveryTargetTool =
              (repeatedRecovery?.alternativeCandidates?.[0] as string | undefined) ??
              repeated.toolName;
            const openedRecovery = openSignal(state.signalLedger ?? [], {
              signalKind: "redirect",
              origin: "loop/iterate-pass.ts:710:repeated-identical-failure",
              target: { tool: recoveryTargetTool, policy: recoveryTargetPolicy },
              iter: state.iteration,
              content: guidance,
            });
            const priorRefs = state.pendingGuidance?.pendingSignals ?? [];
            state = transitionState(state, {
              signalLedger: openedRecovery.ledger,
              pendingGuidance: {
                ...(state.pendingGuidance ?? {}),
                errorRecovery: guidance,
                pendingSignals: [...priorRefs, { signalId: openedRecovery.signalId, field: "errorRecovery", target: { tool: recoveryTargetTool, policy: recoveryTargetPolicy } }],
              },
            });
            yield* emitHarnessSignalInjected({
              taskId: currentOptions.taskId ?? state.taskId,
              iteration: state.iteration,
              signalKind: "redirect",
              origin: "loop/iterate-pass.ts:710:repeated-identical-failure",
              content: guidance,
              signalId: openedRecovery.signalId,
              targetTool: recoveryTargetTool,
              targetPolicy: recoveryTargetPolicy,
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
              steps: [
                ...state.steps,
                makeStep("harness_signal", `⚠️ ${guidance}`, {
                  // Spec §5b (W-Q) — the F3 immediate redirect is a
                  // receipt-visible intervention. Deterministic: an exact
                  // (tool, errorClass) repeat is an evidence-driven fact.
                  intervention: {
                    actor: "repeated-identical-failure",
                    authorityClass: authorityOf("repeated-identical-failure"),
                    evidence: `${repeated.toolName} failed ${repeated.streak}× with errorClass=${repeated.errorClass}`,
                    whatChanged: "repeated-identical-failure: injected recovery steering",
                    iter: state.iteration,
                  },
                }),
              ],
              pendingGuidance: {
                ...(state.pendingGuidance ?? {}),
                errorRecovery: guidance,
              },
              error: null,
            });
            return "continue";
          }
        }
      }

      // ── Lane controller (gather vs synthesize) ───────────────────────────
      const laneSeam = applyExecutionLane({ state, currentInput });
      state = laneSeam.state;
      const laneDecision = laneSeam.laneDecision;

      // ── Harness artifact stall tracking ─────────────────────────────────
      // Track whether this iteration produced new non-meta tool observations.
      // The harness owns completion: when the model stalls but has gathered
      // useful data, it assembles and delivers the accumulated artifacts.
      const totalArtifacts = countDeliverableCandidates(state);
      const artifactDelta = Math.max(0, totalArtifacts - prevArtifactCount);
      // E2 (audit 02-#3 stall staleness): the stall counter tracked new
      // deliverable ARTIFACTS only — blind to a gathering iteration that
      // produced new evidence but no file yet. Under the long-horizon profile,
      // new substantive evidence (assessment.evidenceDelta > 0) also resets the
      // stall counter so the harness does not take over mid-gather. OFF →
      // byte-identical to the legacy expression.
      consecutiveStalled = nextStalledCount(
        consecutiveStalled,
        artifactDelta,
        horizon !== undefined,
        state.meta.assessment,
      );
      prevArtifactCount = totalArtifacts;

      // When reactive intelligence is active it needs at least iteration 2 before it
      // can evaluate early-stop. Give it runway by raising the stall threshold to 4
      // so the RI evaluator always gets a chance to act before the harness fires.
      // Detection is purely structural — `services.reactiveController._tag === "Some"`
      // avoids importing anything from the reactive-intelligence package.
      const riActive = services.reactiveController._tag === "Some";
      // A2 — under the long-horizon profile the stall threshold scales with
      // maxIterations (max(2, 10% of maxIter); RI floor 4). Off → literals 4/2.
      const stallThreshold = riActive
        ? (horizon?.stallThresholdRI ?? 4)
        : (horizon?.stallThreshold ?? 2);

      const stallTriggered =
        consecutiveStalled >= stallThreshold &&
        state.iteration >= 2 &&
        state.status === "thinking";

      // ── Control plane (stall seam) — resolve steer vs abstain ───────────────
      // Decomposed verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
      if (horizon !== undefined && stallTriggered) {
        const stallPlane = yield* resolveStallControlPlane({
          state, currentInput, requiredTools, currentOptions, horizon, laneDecision,
        });
        state = stallPlane.state;
        if (stallPlane.abstained) {
          return "break";
        }
      }
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
          horizonIgnoredNudgeTolerance: horizon?.ignoredNudgeTolerance,
          // E2 (audit 02-#6): a gathering-phase non-write must not count as an
          // "ignored" required-tool nudge — the run is legitimately still
          // collecting inputs before it can call a terminal write tool. OFF →
          // false → the ignored-nudge definition is byte-identical.
          gatheringPhase: assessmentIsGatheringPhase(horizon !== undefined, state.meta.assessment),
        });
        state = stallResult.state;
        requiredToolNudgeCount = stallResult.requiredToolNudgeCount;
        failureRecoveryRedirects = stallResult.failureRecoveryRedirects;
        if (stallResult.outcome === "break") { return "break"; }
        if (stallResult.outcome === "next") { return "continue"; }
      }

      // ── Intelligent Context Synthesis (before thinking step) ──
      // Produces a steering nudge appended to the FC thread — never replaces it.
      // Skip when status is "acting" — tool calls are pending but haven't executed
      // yet, so toolsUsed is stale and any nudge would be contradictory.
      const oracleReady = getLastPulseReadyToAnswer(state);
      const shouldAllowIcsNudge =
        state.status === "thinking" && (!oracleReady || laneDecision.lane === "gather");
      const effectiveToolsUsed = buildEffectiveToolsUsed(state);
      state = yield* runIcsNudgeStep({ state, currentInput, effectiveToolsUsed, profile, shouldAllowIcsNudge });

      // ── Oracle hard gate (pulse readyToAnswer two-stage escalation) ──────
      // When the pulse tool has reported readyToAnswer=true but the model
      // has not called final-answer, escalate in two stages:
      //   Stage 1: inject a mandatory steering nudge, increment nudge count.
      //   Stage 2: after N ignored nudges (tier-dependent), force-exit with "oracle_forced".
      if (state.status !== "done" && state.status !== "failed") {
        const nudgeCount = state.readyToAnswerNudgeCount ?? 0;
        // A2 — effective oracle nudge limit: tier base + long-horizon bonus (0
        // when the profile is off → tier base, byte-identical). Computed once so
        // the force-exit gate and the nudge builder's "last chance" footer agree.
        const effectiveOracleNudgeLimit =
          (TIER_GUARD_THRESHOLDS[profile.tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).oracleNudgeLimit +
          (horizon?.oracleNudgeBonus ?? 0);
        const shouldNudgeForOracle = shouldInjectOracleNudge({
          lane: laneDecision.lane,
          oracleReady,
        });

        if (
          shouldNudgeForOracle &&
          shouldForceOracleExit({
            oracleReady,
            readyToAnswerNudgeCount: nudgeCount,
            tier: profile.tier,
            nudgeLimitOverride: effectiveOracleNudgeLimit,
          })
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
          const mandatoryNudge = buildOracleNudge({
            nudgeCount,
            nudgeLimit: effectiveOracleNudgeLimit,
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
        const detection = detectLoopPattern(
          state.steps,
          maxSameTool,
          maxRepeatedThought,
          maxConsecutiveThoughts,
          { evidenceStaleIterations },
        );
        const loopMsg = detection?.message ?? null;

        // ── Strategy switching ────────────────────────────────────────────
        if (loopMsg !== null) {
          const switchCfg = options.strategySwitching;
          const maxSwitches = switchCfg?.maxSwitches ?? 1;

          if (switchCfg?.enabled && switchCount < maxSwitches) {
            // Transition to "evaluating" while we decide
            state = transitionState(state, { status: "evaluating" });

            const evaluation = yield* resolveLoopSwitchEvaluation({
              state, switchCfg, currentInput, triedStrategies,
            });

            // Fire evaluated hook regardless of whether switch will happen — observability
            yield* hooks.onStrategySwitchEvaluated(state, evaluation);

            if (evaluation.shouldSwitch && evaluation.recommendedStrategy) {
              if (horizon !== undefined) {
                // Control plane (F1) — switch vs abstain (the P5 fix). Decomposed
                // verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
                const switchPlane = yield* resolveSwitchControlPlane({
                  state, currentInput, requiredTools, currentOptions, horizon,
                });
                state = switchPlane.state;
                if (switchPlane.abstained) {
                  return "break";
                }
              }
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
                failureReason:
                  detection !== null
                    ? `pattern=${detection.pattern.id} (${detection.pattern.name}); ${detection.message}`
                    : loopMsg,
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
              return "continue";
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
        const missingTools = missingRequiredToolsForInput(state.steps, currentInput, state.ledger);
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
            return "break";
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
      // Decomposed verbatim to ./iterate-learn-seam.ts (quality program Task 9);
      // cursor bookkeeping unchanged (advance only when a layer is present).
      ({ prevStepCountForLearn, prevDecisionLogCountForLearn } = yield* forkIterLearnWrite({
        state, prevStepCountForLearn, prevDecisionLogCountForLearn,
      }));

    // Body fall-through — outer while loop should re-evaluate and call us again.
    return "continue";
    });

    // ── Single-writer write-back — the ONLY place locals reach the carrier ──
    // Runs once per pass, unconditionally after the inner body settles (every
    // exit path: both "break" and "continue"). The outer while loop re-reads
    // the carrier on each pass and the post-loop finalization reads
    // carrier.{state,currentInput,currentOptions}, so these must be current.
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

    return signal;
  });
}
