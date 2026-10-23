/**
 * iterate-recall-seam.ts — per-iteration RecallService dispatch, decomposed
 * VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222; formerly
 * lines 765-782, inside the seam whose wire-spot rationale comment stays with
 * the driver). Issue #129 / North Star §4.3 / Audit G-C.
 */
import { Effect } from "effect";
import {
  RecallService,
  type MemoryRecallResult,
  type FoundSkill,
} from "../capabilities/recall/recall-service.js";
import { type KernelState } from "../../kernel/state/kernel-state.js";

/** Run this pass's recall dispatch (serviceOption — no layer ⇒ empty locals). */
export function runPerIterRecall(args: {
  readonly state: KernelState;
}): Effect.Effect<{
  readonly iterRecallContext: MemoryRecallResult;
  readonly iterRecallSkills: readonly FoundSkill[];
}, never, never> {
  return Effect.gen(function* () {
    const { state } = args;

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
    return { iterRecallContext, iterRecallSkills };
  });
}
