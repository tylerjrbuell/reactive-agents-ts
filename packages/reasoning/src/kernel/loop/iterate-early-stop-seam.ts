/**
 * iterate-early-stop-seam.ts — dispatcher-early-stop handling, decomposed
 * VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222; formerly
 * lines 1073-1116, inside the `terminatedBy === "dispatcher-early-stop"`
 * guard which stays in the driver).
 *
 * Gives the run ONE evidence-grace turn when unconsumed stored evidence exists
 * (2026-08-16 root fix), else honors the forced stop through the Arbitrator
 * veto. The two `return "break"/"continue"` sites adapt to a returned
 * IterationSignal the driver forwards — control-flow-only deviation.
 */
import { Effect } from "effect";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { DISPATCHER_EARLY_STOP, proposeExit } from "./exit-gate.js";
import { passthroughOutputDeliverable } from "./runner-helpers/deliverable.js";
import type { IterationSignal } from "./iterate-pass.js";
import { resolveUnconsumedEvidence } from "../capabilities/verify/unconsumed-evidence.js";
import { makeObservationResult } from "../utils/observation-helpers.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import {
  arbitrateAndApplyWithBudgetEmit,
  arbitrationContextFromState,
} from "../capabilities/decide/arbitrator.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { guardEvidence } from "../utils/guard-evidence.js";

/** Handle a dispatcher-early-stop: grace turn or arbitrated termination. */
export function handleDispatcherEarlyStop(args: {
  state: KernelState;
  readonly input: KernelInput;
  readonly effectiveInput: KernelInput;
  /**
   * The live input + options (exit-gate outstanding check + cap bound). Absent
   * (direct seam callers) → `effectiveInput` and `state.meta.maxIterations`; an
   * unknown cap leaves no room for deny-once (the cap is never extended).
   */
  readonly currentInput?: KernelInput;
  readonly currentOptions?: KernelRunOptions;
}): Effect.Effect<{ state: KernelState; signal: IterationSignal }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { input, effectiveInput } = args;

        // 2026-08-16 root fix: measured live as the DOMINANT termination path
        // for local models under entropy/iteration pressure — it interrupts
        // the loop directly, mid-iteration, entirely outside think.ts's
        // per-turn termination oracle (arbitrator.ts's evaluator chain never
        // runs here). Give the run ONE grace turn to ground its answer in
        // evidence it already fetched but never read back (storedKey/recall),
        // rather than honoring the forced stop and shipping whatever the
        // model wrote from a compressed preview. One-shot via
        // `evidenceGraceGiven`: a run genuinely out of budget still honors
        // the NEXT dispatcher-early-stop.
        if (!state.meta.evidenceGraceGiven) {
          const unconsumedEvidence = resolveUnconsumedEvidence(state.steps, state.scratchpad);
          if (unconsumedEvidence !== null) {
            const evidenceMsg =
              `⚠️ Before finalizing: earlier tool results were shown to you only as short previews. ` +
              `Here is the COMPLETE content, expanded automatically — ground your answer in it (do not ` +
              `invent details not present here), then give your final answer now:\n\n${unconsumedEvidence}`;
            const evidenceStep = makeStep("observation", evidenceMsg, {
              observationResult: makeObservationResult("evidence-grounding-guard", false, evidenceMsg),
            });
            state = transitionState(state, {
              steps: [...state.steps, evidenceStep],
              meta: { ...state.meta, terminatedBy: undefined, evidenceGraceGiven: true },
            });
            return { state, signal: "continue" as const };
          }
        }
        // Decision provenance (trace only): the RI evaluator's own reason string
        // carries the entropy numbers it compared (its structured thresholds live
        // in reactive-intelligence — follow-up); the kernel adds the run's corridor.
        yield* emitGuardFired({
          taskId: effectiveInput.taskId ?? state.taskId,
          iteration: state.iteration,
          guard: "dispatcher_early_stop",
          outcome: "terminate",
          reason: "dispatcher_early_stop",
          metadata: {
            evaluatorReason: state.meta.dispatcherEarlyStop?.reason ?? null,
            ...(state.meta.maxIterations !== undefined
              ? guardEvidence("iteration", state.iteration, state.meta.maxIterations)
              : {}),
          },
        });
        // Plan 8 item 3: the early stop is a PROPOSAL. The exit gate denies it
        // once while something is outstanding, hands off when it cannot be
        // denied, and on accept hands finalization to the Arbitrator below
        // (the verdict oracle keeps owning this exit's terminal verdict).
        const arbitrate = (s: KernelState) =>
          // WS-3 Phase 5b — emit BudgetSignal + arbitrate in a single call
          // colocated at the Decide capability boundary (invariant 10).
          arbitrateAndApplyWithBudgetEmit({
            state: s,
            intent: {
              kind: "controller-early-stop",
              output: s.output ?? "",
              reason: "dispatcher_early_stop",
            },
            ctx: arbitrationContextFromState(s, {
              task: input.task,
              requiredTools: input.requiredTools,
            }),
            taskId: effectiveInput.taskId ?? "",
          });
        const gated = yield* proposeExit({
          state,
          proposal: { ...DISPATCHER_EARLY_STOP, deliverable: passthroughOutputDeliverable(state.output) },
          input: args.currentInput ?? effectiveInput,
          maxIterations: args.currentOptions?.maxIterations ?? state.meta.maxIterations ?? state.iteration,
          taskId: effectiveInput.taskId ?? args.currentOptions?.taskId ?? state.taskId,
          accept: arbitrate,
        });
        return { state: gated.state, signal: gated.decision === "deny-once" ? ("continue" as const) : ("break" as const) };
  });
}
