/**
 * iterate-learn-seam.ts — per-iteration LearningPipeline write seam,
 * decomposed VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222;
 * formerly lines 1850-1867). Issue #120 / North Star §4.3 / Audit G-D.
 *
 * Returns the (unchanged) per-iter diff cursors when no LearningPipeline layer
 * is provided — the driver threads them back onto its spine locals.
 */
import { Effect } from "effect";
import { LearningPipeline } from "../capabilities/learn/learning-pipeline.js";
import { type KernelState } from "../../kernel/state/kernel-state.js";

/** Fire-and-forget this pass's learn write; return the advanced cursors. */
export function forkIterLearnWrite(args: {
  readonly state: KernelState;
  prevStepCountForLearn: number;
  prevDecisionLogCountForLearn: number;
}): Effect.Effect<{
  prevStepCountForLearn: number;
  prevDecisionLogCountForLearn: number;
}, never, never> {
  return Effect.gen(function* () {
    let prevStepCountForLearn = args.prevStepCountForLearn;
    let prevDecisionLogCountForLearn = args.prevDecisionLogCountForLearn;
    const { state } = args;
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
    return { prevStepCountForLearn, prevDecisionLogCountForLearn };
  });
}
