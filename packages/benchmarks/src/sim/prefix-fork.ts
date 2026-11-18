/**
 * S6 spike: prefix-fork LLM layer. The first `k` model calls replay the recorded
 * responses (sequence-ordered table: Nth call gets Nth recorded response, so the
 * live prompt's date/time cannot cause a miss); every later call goes to `after`.
 *
 * Feasibility probe only. Limits (see wiki/Research/Spikes-2026-11-18-measurement/S6.md):
 * the fork point is a call INDEX, not a trace state; the recorded responses are
 * replayed blind (no check the live harness reached the same state); recorded
 * `completeStructured` calls die in the replay layer.
 */
import { Context, Effect, Layer, Scope } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { buildSequentialLLMTable, makeReplayLLMLayer } from "@reactive-agents/replay";
import type { TraceEvent } from "@reactive-agents/trace";

export interface ForkHandle {
  readonly layer: Layer.Layer<LLMService>;
  /** Calls answered from the recording / from `after`. */
  readonly counts: () => { readonly replayed: number; readonly substituted: number };
}

/** Build a context-free LLMService layer into its service (these layers are synchronous). */
function serviceOf(layer: Layer.Layer<LLMService>): typeof LLMService.Service {
  return Effect.runSync(
    Layer.buildWithScope(layer, Effect.runSync(Scope.make())).pipe(
      Effect.map((ctx) => Context.get(ctx, LLMService)),
    ),
  );
}

export function prefixForkLayer(
  events: readonly TraceEvent[],
  k: number,
  after: Layer.Layer<LLMService>,
): ForkHandle {
  const recorded = serviceOf(makeReplayLLMLayer(buildSequentialLLMTable(events)));
  const live = serviceOf(after);
  let calls = 0;
  let replayed = 0;
  let substituted = 0;
  const pick = (): typeof LLMService.Service => {
    if (calls++ < k) {
      replayed++;
      return recorded;
    }
    substituted++;
    return live;
  };
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...live,
      complete: (req) => pick().complete(req),
      stream: (req) => pick().stream(req),
    }),
  );
  return { layer, counts: () => ({ replayed, substituted }) };
}
