// File: src/kernel/loop/turn-operations.ts
/**
 * The kernel turn as an ordered list of named operations (Plan 9 Phase 4 /
 * Plan 8 D10). Mirrors `terminal-pipeline.ts`: the order is ONE exported array
 * ({@link KERNEL_TURN_OPERATIONS}), each entry naming the state slices it reads
 * and writes, and a tiny runner ({@link runKernelTurn}) walks it.
 *
 * One pass = run the operations in order until one ends the pass; `"next"`
 * hands on to the following operation, `"continue"` ends the pass, and running
 * off the end is `"continue"`.
 *
 * THE RUN ENDS ONLY THROUGH THE EXIT GATE (Plan 9 Phase 4)
 * ---------------------------------------------------------
 * No operation returns `"break"`. An operation that ends the run proposes the
 * exit to the gate (`exit-gate.ts`) and returns the gate's {@link ExitDisposition};
 * {@link runKernelTurn} maps it: a denial is `"continue"`, an accept or handoff
 * is `"break"`. Only operations declared `proposesExit: true` may return a
 * disposition ({@link TurnOperationImpls} enforces it). Pinned in
 * `tests/kernel/loop/turn-operations.test.ts`, with the `terminate()` census.
 *
 * WHERE THE OPERATIONS LIVE
 * -------------------------
 * Operations with no script-anchored content are implemented HERE
 * ({@link SEAM_TURN_OPERATIONS}). The guard and control operations whose bodies
 * the CI gates content-match live in `turn-guard-operations.ts`, which those
 * scripts name: private run-progress counter writes (`check-run-assessment.sh`),
 * the `applyStrategySwitch(` calls (`check-control-plane.sh`), and the
 * `recompileOnAssessment(` call (`check-policy-compiler.sh`).
 *
 * SLICES
 * ------
 * `state.<field>` = a `KernelState` field; `state` = the whole state (an opaque
 * helper such as the kernel step); `carry.<field>` = a spine local that survives
 * passes ({@link IterationCarrier}); `pass.<field>` = a value one operation hands
 * a later one within the same pass ({@link TurnPassLocals}). Every `pass.*` read
 * must follow its write in the list (pinned).
 *
 * TURN ORDER (current, behavior-identical to the pre-list body)
 * --------------------------------------------------------------
 *   run-control-checkpoint → iteration-start → assess-pass-start → recall →
 *   think → grounding-redirect-trace → low-delta-guard → auto-checkpoint →
 *   scratchpad-sync → reactive-observer → dispatcher-early-stop →
 *   dispatcher-strategy-switch → iteration-progress →
 *   repeated-failure-redirect → execution-lane → stall → ics-nudge →
 *   oracle-gate → primary-tools-exit → loop-detection → required-tools-guard →
 *   post-iteration-snapshot → learn-write
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { RunControllerLike } from "@reactive-agents/core";
import { getRunSlot, runControllerSlot } from "@reactive-agents/core/internal/run-scope";
import type { KernelState } from "../state/kernel-state.js";
import type { LaneDecision } from "../utils/lane-controller.js";
import type { IterationCarrier, IterationConfig, IterationSignal } from "./iterate-pass.js";
import { isExitDenial, type ExitDisposition } from "./exit-gate.js";
import { emitKernelStateSnapshot } from "../utils/diagnostics.js";
import { runPhaseHooks } from "./phase-hooks.js";
import { runReactiveObserver } from "../capabilities/reflect/reactive-observer.js";
import { checkAllToolsCalled } from "../capabilities/reflect/loop-detector.js";
import { getLastPulseReadyToAnswer } from "./runner-helpers/state-queries.js";
import { buildEffectiveToolsUsed } from "./runner-helpers/deliverable.js";
import { runPassBoundaryCheckpoint, runPostPhaseCheckpointSeams } from "./iterate-run-ctl-checkpoint.js";
import { assessAfterAct } from "./iterate-assessment-seam.js";
import { runPerIterRecall } from "./iterate-recall-seam.js";
import { runBeforeThinkHooks } from "./iterate-before-think-seam.js";
import { handleDispatcherEarlyStop } from "./iterate-early-stop-seam.js";
import { runAutoCheckpointStep, applyExecutionLane, runIcsNudgeStep } from "./iterate-guard-seams.js";
import { forkIterLearnWrite } from "./iterate-learn-seam.js";

/** Values one operation hands a later one within a single pass (reset per pass). */
export interface TurnPassLocals {
  /** The run's pause/stop controller, read once at pass start. */
  runCtl: RunControllerLike | null;
  /** `state.tokens` at pass start (token-delta guard baseline). */
  prevTokens: number;
  /** W4.1 (e) — evidence-staleness iterations at pass start (ledger-derived). */
  evidenceStaleIterations: number;
  /** F3 marker: step count before the kernel step (failures appended THIS pass). */
  stepsAtPassStart: number;
  /** F1 marker: grounding-redirect count before the Arbitrator could bump it. */
  groundingRedirectsAtPassStart: number;
  /** Tool calls made this pass (duplicates kept). */
  toolsThisStep: string[];
  /** Gather vs synthesize lane for this pass. */
  laneDecision: LaneDecision;
  /** Pulse `readyToAnswer` as seen by the ICS step (read again by the oracle gate). */
  oracleReady: boolean;
}

/** The mutable per-pass scope every operation reads and writes. */
export interface TurnScope extends IterationCarrier {
  readonly pass: TurnPassLocals;
}

/** A pass's spine scope seeded from the carrier; `pass` starts at its defaults. */
export function openTurnScope(carrier: IterationCarrier): TurnScope {
  return {
    ...carrier,
    pass: {
      runCtl: null,
      prevTokens: 0,
      evidenceStaleIterations: 0,
      stepsAtPassStart: 0,
      groundingRedirectsAtPassStart: 0,
      toolsThisStep: [],
      laneDecision: { lane: "gather", canFinalize: false, missingRequiredTools: [] },
      oracleReady: false,
    },
  };
}

type StateSlot = "state" | `state.${keyof KernelState & string}` | `state.meta.${string}`;
type CarrySlot = `carry.${Exclude<keyof IterationCarrier, "state"> & string}`;
type PassSlot = `pass.${keyof TurnPassLocals & string}`;
/** A state slice an operation declares it reads or writes. */
export type TurnSlot = StateSlot | CarrySlot | PassSlot;

/** One entry of the turn list. */
export interface TurnOperationSpec {
  readonly name: string;
  readonly reads: readonly TurnSlot[];
  readonly writes: readonly TurnSlot[];
  /** True when the operation may propose an exit and return the exit gate's disposition. */
  readonly proposesExit: boolean;
}

/** The ordered turn — the pass's public shape (pinned). Order is behavior. */
export const KERNEL_TURN_OPERATIONS = [
  { name: "run-control-checkpoint", reads: ["state"], writes: ["state", "pass.runCtl"], proposesExit: true },
  { name: "iteration-start", reads: ["state.tokens", "state.iteration"], writes: ["pass.prevTokens"], proposesExit: false },
  {
    name: "assess-pass-start",
    reads: ["state.meta.runContract", "state.meta.harnessPlan", "state.iteration"],
    writes: ["state.meta.assessment", "state.meta.harnessPlan", "state.ledger", "state.status", "pass.evidenceStaleIterations"],
    proposesExit: true,
  },
  { name: "recall", reads: ["state"], writes: [], proposesExit: false },
  {
    name: "think",
    reads: ["state", "carry.currentContext", "pass.runCtl"],
    writes: ["state", "pass.stepsAtPassStart", "pass.groundingRedirectsAtPassStart"],
    proposesExit: true,
  },
  {
    name: "grounding-redirect-trace",
    reads: ["state.meta.groundingRedirectCount", "state.steps", "pass.groundingRedirectsAtPassStart"],
    writes: ["state.signalLedger", "state.pendingGuidance"],
    proposesExit: false,
  },
  {
    name: "low-delta-guard",
    reads: ["state.tokens", "state.meta.assessment", "pass.prevTokens"],
    writes: ["state.consecutiveLowDeltaCount", "state.status", "state.output"],
    proposesExit: true,
  },
  { name: "auto-checkpoint", reads: ["state", "carry.autoCheckpointed"], writes: ["carry.autoCheckpointed"], proposesExit: false },
  { name: "scratchpad-sync", reads: ["state.scratchpad"], writes: ["carry.mutableScratchpad"], proposesExit: false },
  {
    name: "reactive-observer",
    reads: ["state", "carry.prevStepCount", "carry.failureRecoveryRedirects", "carry.switchCount"],
    writes: ["state", "carry.prevStepCount"],
    proposesExit: false,
  },
  { name: "dispatcher-early-stop", reads: ["state.meta.terminatedBy"], writes: ["state"], proposesExit: true },
  {
    name: "dispatcher-strategy-switch",
    reads: ["state.meta.terminatedBy", "state.meta.dispatchedStrategySwitch", "carry.switchCount", "carry.triedStrategies"],
    writes: [
      "state", "carry.currentInput", "carry.currentContext", "carry.currentOptions", "carry.switchCount",
      "carry.prevActionCount", "carry.requiredToolRedirects", "carry.consecutiveStalled",
      "carry.prevArtifactCount", "carry.failureRecoveryRedirects",
    ],
    proposesExit: true,
  },
  {
    name: "iteration-progress",
    reads: ["state.steps", "carry.prevActionCount"],
    writes: ["carry.prevActionCount", "pass.toolsThisStep"],
    proposesExit: false,
  },
  {
    name: "repeated-failure-redirect",
    reads: ["state.steps", "state.meta.assessment", "carry.failureRecoveryRedirects", "pass.stepsAtPassStart"],
    writes: ["state.signalLedger", "state.pendingGuidance", "state.steps", "state.status", "carry.failureRecoveryRedirects"],
    proposesExit: true,
  },
  { name: "execution-lane", reads: ["state.evidence"], writes: ["state.meta.executionLane", "state.meta.missingRequiredTools", "pass.laneDecision"], proposesExit: false },
  {
    name: "stall",
    reads: ["state", "carry.consecutiveStalled", "carry.prevArtifactCount", "pass.toolsThisStep", "pass.laneDecision"],
    writes: [
      "state", "carry.consecutiveStalled", "carry.prevArtifactCount",
      "carry.requiredToolNudgeCount", "carry.failureRecoveryRedirects",
    ],
    proposesExit: true,
  },
  { name: "ics-nudge", reads: ["state", "pass.laneDecision"], writes: ["state.pendingGuidance", "pass.oracleReady"], proposesExit: false },
  {
    name: "oracle-gate",
    reads: ["state.readyToAnswerNudgeCount", "state.output", "state.steps", "pass.laneDecision", "pass.oracleReady"],
    writes: ["state.readyToAnswerNudgeCount", "state.pendingGuidance", "state.status", "state.output"],
    proposesExit: true,
  },
  { name: "primary-tools-exit", reads: ["state.toolsUsed"], writes: ["state.status", "state.output"], proposesExit: false },
  {
    name: "loop-detection",
    reads: ["state.steps", "state.meta.assessment", "carry.switchCount", "pass.evidenceStaleIterations"],
    writes: [
      "state", "carry.currentInput", "carry.currentContext", "carry.currentOptions", "carry.switchCount",
      "carry.prevActionCount", "carry.requiredToolRedirects", "carry.consecutiveStalled",
      "carry.prevArtifactCount", "carry.failureRecoveryRedirects", "carry.requiredToolNudgeCount",
    ],
    proposesExit: true,
  },
  {
    name: "required-tools-guard",
    reads: ["state.status", "state.meta.terminatedBy", "state.toolsUsed", "carry.requiredToolRedirects"],
    writes: ["state.status", "state.output", "state.steps", "state.error", "carry.requiredToolRedirects"],
    proposesExit: true,
  },
  { name: "post-iteration-snapshot", reads: ["state"], writes: [], proposesExit: false },
  {
    name: "learn-write",
    reads: ["state", "carry.prevStepCountForLearn", "carry.prevDecisionLogCountForLearn"],
    writes: ["carry.prevStepCountForLearn", "carry.prevDecisionLogCountForLearn"],
    proposesExit: false,
  },
] as const satisfies readonly TurnOperationSpec[];

type OperationEntry = (typeof KERNEL_TURN_OPERATIONS)[number];
export type KernelTurnOperationName = OperationEntry["name"];
type ProposingOperationName = Extract<OperationEntry, { proposesExit: true }>["name"];

/**
 * `"next"` hands on to the following operation; `"continue"` ends the pass; an
 * {@link ExitDisposition} is the exit gate's answer to a proposed exit (the only
 * way a pass ends the run). There is no `"break"`.
 */
export type TurnSignal = "next" | "continue" | ExitDisposition;

/** One operation over the pass scope. */
export type TurnOperation<S extends TurnSignal = TurnSignal> = (
  t: TurnScope,
  cfg: IterationConfig,
) => Effect.Effect<S, never, LLMService>;

/** Implementations keyed by name; only `proposesExit: true` operations may return a gate disposition. */
export type TurnOperationImpls = {
  readonly [K in KernelTurnOperationName]: TurnOperation<
    K extends ProposingOperationName ? TurnSignal : "next" | "continue"
  >;
};

/** Literal-typed hand-on signal (a bare `"next"` widens to `string` inside `Effect.gen`). */
const NEXT = "next" as const;

/** The operations implemented in this module (the rest: `turn-guard-operations.ts`). */
export type SeamOperationName =
  | "run-control-checkpoint" | "iteration-start" | "recall" | "think" | "auto-checkpoint"
  | "scratchpad-sync" | "reactive-observer" | "dispatcher-early-stop"
  | "iteration-progress" | "execution-lane" | "ics-nudge" | "primary-tools-exit"
  | "post-iteration-snapshot" | "learn-write";

/** Operations with no script-anchored content (bodies moved verbatim from iterate-pass.ts). */
export const SEAM_TURN_OPERATIONS: Pick<TurnOperationImpls, SeamOperationName> = {
  "run-control-checkpoint": (t) =>
    Effect.gen(function* () {
      // Pause/stop checkpoint: awaits resume() if paused, returns { stop: true } on stop().
      const _runCtl = yield* getRunSlot(runControllerSlot);
      t.pass.runCtl = _runCtl;
      if (_runCtl) {
        const passBoundary = yield* runPassBoundaryCheckpoint({ state: t.state, _runCtl });
        t.state = passBoundary.state;
        if (passBoundary.exit) {
          return passBoundary.exit;
        }
      }
      return NEXT;
    }),

  "iteration-start": (t, cfg) =>
    Effect.gen(function* () {
      t.pass.prevTokens = t.state.tokens;

      yield* cfg.emitLog({
        _tag: "iteration",
        iteration: t.state.iteration,
        phase: "thought",
        timestamp: new Date(),
      });

      // Snapshot kernel state at iteration start — gives `rax diagnose` and
      // Cortex UI a per-iteration baseline of what the agent saw.
      yield* emitKernelStateSnapshot({
        state: t.state,
        taskId: t.currentOptions.taskId ?? t.state.taskId,
        iteration: t.state.iteration,
      });
      return NEXT;
    }),

  recall: (t) =>
    Effect.gen(function* () {
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
      const { iterRecallContext, iterRecallSkills } = yield* runPerIterRecall({ state: t.state });
      // Phase 1 leaves iterRecallContext / iterRecallSkills unused beyond
      // capture — strategies still consume `input.priorContext` /
      // `input.briefResolvedSkills` as today. Phase 2 (runtime-warden) will
      // either merge these into the prompt directly or expose via a new
      // KernelState field once the upstream `engine/bootstrap` recall is
      // migrated through this seam.
      void iterRecallContext;
      void iterRecallSkills;
      return NEXT;
    }),

  think: (t, cfg) =>
    Effect.gen(function* () {
      const { kernel, effectiveInput, emitLog } = cfg;
      const kernelPhaseStart = Date.now();
      // F1/F3 pass-start markers (2026-07-02): step count before the kernel
      // phase runs (so F3 fires only on failures appended THIS pass, never on a
      // stale streak) and the grounding-redirect counter before the Arbitrator
      // could bump it (so the F1 redirect emits exactly one trace event).
      t.pass.stepsAtPassStart = t.state.steps.length;
      t.pass.groundingRedirectsAtPassStart = t.state.meta.groundingRedirectCount ?? 0;

      // `kernel` is a STATUS-DISPATCHED transition (react-kernel.ts): it runs
      // the think capability on status "thinking" and the ACT capability on
      // status "acting". This pass therefore only owns the `think` phase when
      // it is about to dispatch a thinking step. Firing `think` hooks around
      // an acting dispatch reported every tool execution as a reasoning step:
      // user `think` hooks ran on tool calls, and a think-scoped killswitch
      // counted them, roughly doubling the observed think count. The act
      // dispatch fires its own `before`/`after` `act` hooks (with the same
      // abort semantics) inside act.ts, so it needs no wrapper here.
      const dispatchesThink = t.state.status === "thinking";

      if (dispatchesThink) {
        yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });
      }

      // 'before think' hooks — may abort iteration. Decomposed verbatim to
      // ./iterate-before-think-seam.ts (quality program Task 9).
      const beforeThink = yield* runBeforeThinkHooks({
        state: t.state, effectiveInput, eventBus: cfg.services.eventBus, dispatchesThink,
      });
      t.state = beforeThink.state;
      if (beforeThink.exit) {
        return beforeThink.exit;
      }

      t.state = yield* kernel(t.state, t.currentContext);
      // Plan 9 item 9: the pass's ONE assessment, after the act; every guard below reads it.
      t.state = yield* assessAfterAct({ state: t.state, currentOptions: t.currentOptions });

      // Live-inspection post-phase seam + durable HITL/interaction paused-state
      // checkpoint — decomposed verbatim to ./iterate-run-ctl-checkpoint.ts
      // (quality program Task 9).
      yield* runPostPhaseCheckpointSeams({ state: t.state, _runCtl: t.pass.runCtl });

      // 'after think' hooks — paired with the 'before' fire above, so they
      // only run when this pass actually dispatched a thinking step.
      if (dispatchesThink) {
        const state = t.state;
        yield* Effect.promise(() =>
          runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'think', state.iteration, state)
        );

        yield* emitLog({
          _tag: "phase_complete",
          phase: "think",
          duration: Date.now() - kernelPhaseStart,
          status: t.state.status === "failed" ? "error" : "success",
        });
      }
      return NEXT;
    }),

  "auto-checkpoint": (t, cfg) =>
    Effect.gen(function* () {
      // ── Auto-checkpoint before context pressure gate ────────────────────
      // Decomposed verbatim to ./iterate-guard-seams.ts (quality Task 9).
      ({ autoCheckpointed: t.autoCheckpointed } = yield* runAutoCheckpointStep({
        state: t.state, profile: cfg.profile, autoCheckpointed: t.autoCheckpointed, emitLog: cfg.emitLog,
      }));
      return NEXT;
    }),

  "scratchpad-sync": (t) => {
    // Sync scratchpad: kernel may have added entries
    for (const [k, v] of t.state.scratchpad) {
      t.mutableScratchpad.set(k, v);
    }
    return Effect.succeed("next");
  },

  "reactive-observer": (t, cfg) =>
    Effect.gen(function* () {
      // ── Entropy scoring + Reactive Controller evaluation ────────────────
      ({ state: t.state, prevStepCount: t.prevStepCount } = yield* runReactiveObserver(
        t.state, cfg.services, cfg.services.eventBus, t.prevStepCount, t.currentOptions, {
          harnessPipeline: cfg.effectiveInput.harnessPipeline,
          // RC-3 — the kernel's repeated-identical-failure redirect streak is the
          // single loop-stuck trigger authority. This observer runs BEFORE this
          // pass's F3 redirect block, so RI sees the count as of the kernel's last
          // committed redirect and can only escalate a stall the kernel already
          // acted on (previously both fired independently, one iteration apart).
          redirectsIssued: t.failureRecoveryRedirects,
          // RI census 2026-11-06: the dispatcher-strategy-switch op turns a switch
          // request it cannot honor into a switching_exhausted exit, so RI must
          // not propose a switch the run cannot make (same test as that op).
          switchingAvailable:
            cfg.options.strategySwitching?.enabled === true &&
            t.switchCount < (cfg.options.strategySwitching.maxSwitches ?? 1),
        },
      ));
      return NEXT;
    }),

  "dispatcher-early-stop": (t, cfg) =>
    Effect.gen(function* () {
      // ── Honor early-stop dispatched by the intervention dispatcher ────────
      // Decomposed verbatim to ./iterate-early-stop-seam.ts (quality Task 9):
      // one evidence-grace turn when unconsumed stored evidence exists (2026-08-16
      // root fix), else the Arbitrator veto honors the forced stop.
      if (t.state.meta.terminatedBy === "dispatcher-early-stop") {
        const earlyStop = yield* handleDispatcherEarlyStop({
          state: t.state, input: cfg.input, effectiveInput: cfg.effectiveInput,
          currentInput: t.currentInput, currentOptions: t.currentOptions,
        });
        t.state = earlyStop.state;
        return earlyStop.signal;
      }
      return NEXT;
    }),

  "iteration-progress": (t, cfg) =>
    Effect.gen(function* () {
      // ── Iteration progress hook ──────────────────────────────────────────
      // Compute which tools were called in THIS iteration by scanning new action
      // steps since prevStepCount. Includes duplicates so parallel batches
      // (e.g. 4x web-search) report all 4 calls, not just the unique name.
      const toolsThisStep: string[] = [];
      for (let i = t.prevActionCount; i < t.state.steps.length; i++) {
        const s = t.state.steps[i];
        if (s.type === "action") {
          const toolName = (s.metadata?.toolUsed ?? (s.metadata?.toolCall && (s.metadata.toolCall as { name?: string }).name)) as string | undefined;
          if (toolName) toolsThisStep.push(toolName);
        }
      }
      t.pass.toolsThisStep = toolsThisStep;
      yield* cfg.hooks.onIterationProgress(t.state, toolsThisStep);
      t.prevActionCount = t.state.steps.length;
      return NEXT;
    }),

  "execution-lane": (t) => {
    // ── Lane controller (gather vs synthesize) ───────────────────────────
    const laneSeam = applyExecutionLane({ state: t.state, currentInput: t.currentInput });
    t.state = laneSeam.state;
    t.pass.laneDecision = laneSeam.laneDecision;
    return Effect.succeed("next");
  },

  "ics-nudge": (t, cfg) =>
    Effect.gen(function* () {
      // ── Intelligent Context Synthesis (before thinking step) ──
      // Produces a steering nudge appended to the FC thread — never replaces it.
      // Skip when status is "acting" — tool calls are pending but haven't executed
      // yet, so toolsUsed is stale and any nudge would be contradictory.
      const oracleReady = getLastPulseReadyToAnswer(t.state);
      t.pass.oracleReady = oracleReady;
      const shouldAllowIcsNudge =
        t.state.status === "thinking" && (!oracleReady || t.pass.laneDecision.lane === "gather");
      const effectiveToolsUsed = buildEffectiveToolsUsed(t.state);
      t.state = yield* runIcsNudgeStep({
        state: t.state, currentInput: t.currentInput, effectiveToolsUsed, profile: cfg.profile, shouldAllowIcsNudge,
      });
      return NEXT;
    }),

  "primary-tools-exit": (t) => {
    // ── Early exit: primary scoped tools called ─────────────────────────
    // For composite steps in plan-execute, exit as soon as all primary
    // (non-utility) tools have been called.
    t.state = checkAllToolsCalled(t.state, t.currentInput, t.currentOptions);
    return Effect.succeed("next");
  },

  "post-iteration-snapshot": (t) =>
    Effect.gen(function* () {
      // ── Post-iteration snapshot ──────────────────────────────────────────
      // Capture state AFTER kernel() ran and post-processing finalized.
      // Without this, traces only show iter-start (steps=0) and the verifier
      // verdict — no visibility into step composition, output, or terminatedBy
      // for the iter that actually produced output. See diagnostic gap found
      // 2026-04-27 (T4: 6 events, status=done invisible).
      yield* emitKernelStateSnapshot({
        state: t.state,
        taskId: t.currentOptions.taskId ?? t.state.taskId,
        iteration: t.state.iteration,
      });
      return NEXT;
    }),

  "learn-write": (t) =>
    Effect.gen(function* () {
      // ── Learn capability — per-iter LearningPipeline write ───────────────
      // Decomposed verbatim to ./iterate-learn-seam.ts (quality program Task 9);
      // cursor bookkeeping unchanged (advance only when a layer is present).
      ({ prevStepCountForLearn: t.prevStepCountForLearn, prevDecisionLogCountForLearn: t.prevDecisionLogCountForLearn } =
        yield* forkIterLearnWrite({
          state: t.state, prevStepCountForLearn: t.prevStepCountForLearn, prevDecisionLogCountForLearn: t.prevDecisionLogCountForLearn,
        }));
      return NEXT;
    }),
};

/**
 * Run one pass: the operations in {@link KERNEL_TURN_OPERATIONS} order until one
 * ends the pass. Running off the end is `"continue"` (the body fall-through).
 * An exit-gate disposition is the only way to `"break"`: the gate's state
 * becomes the pass state, and a denial keeps the run going.
 */
export function runKernelTurn(
  t: TurnScope,
  cfg: IterationConfig,
  ops: TurnOperationImpls,
): Effect.Effect<IterationSignal, never, LLMService> {
  return Effect.gen(function* () {
    for (const { name } of KERNEL_TURN_OPERATIONS) {
      const op: TurnOperation = ops[name];
      const signal = yield* op(t, cfg);
      if (signal === "next") continue;
      if (signal === "continue") return "continue";
      t.state = signal.state;
      return isExitDenial(signal.decision) ? "continue" : "break";
    }
    return "continue";
  });
}
