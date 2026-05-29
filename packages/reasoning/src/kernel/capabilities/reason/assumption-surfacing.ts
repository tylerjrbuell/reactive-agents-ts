/**
 * Assumption surfacing — emit model-stated assumptions as
 * AssumptionRecordedEmitted events.
 *
 * Extracted from think.ts (WS-6 Phase 6). Pairs with the pure
 * `assumption-detector.ts` (detection) on the effectful (emission) side:
 * detection stays a pure function over text, emission is the side-effect that
 * publishes each detected assumption on the EventBus.
 *
 * Best-effort: failure is swallowed inside `emitAssumptionRecorded` so the
 * Reason phase never breaks on a telemetry hiccup. Reads only immutable inputs
 * (thought + thinking text, taskId, iteration); writes nothing back to state.
 */
import { Effect } from "effect";
import { detectAssumptions } from "./assumption-detector.js";
import { emitAssumptionRecorded } from "../../utils/diagnostics.js";

const MAX_ASSUMPTIONS = 3;

/**
 * Detect assumptions in the visible thought (and, when present, the hidden
 * thinking trace — deduped and capped at the global limit), then emit an
 * AssumptionRecordedEmitted event per assumption.
 */
export function surfaceAssumptions(args: {
  readonly thought: string;
  readonly thinking: string | null;
  readonly taskId: string;
  readonly iteration: number;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const assumptions = detectAssumptions(args.thought);
    if (assumptions.length > 0 && args.thinking) {
      // Also scan the hidden thinking trace, capped to the global limit (3).
      const fromThinking = detectAssumptions(args.thinking);
      for (const a of fromThinking) {
        if (assumptions.length >= MAX_ASSUMPTIONS) break;
        if (!assumptions.some((x) => x.assumption === a.assumption)) {
          assumptions.push(a);
        }
      }
    }
    for (const a of assumptions) {
      yield* emitAssumptionRecorded({
        taskId: args.taskId,
        iteration: args.iteration,
        assumption: a.assumption,
        rationale: a.rationale,
      });
    }
  });
}
