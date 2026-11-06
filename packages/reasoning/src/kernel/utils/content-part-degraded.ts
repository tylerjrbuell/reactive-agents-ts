/**
 * kernel/utils/content-part-degraded.ts — the `content-part-degraded` fact,
 * kernel side (Plan 9 Phase 4 stage F).
 *
 * `toLLMMessages` replaces some non-text parts with deterministic text stubs
 * (audio, file, unsupported image types, media in tool results). Each stub is
 * published as a `ContentPartDegraded` event, which the trace bridge records as
 * `content-part-degraded`, so a degraded part is visible in the trace instead
 * of silent. Summaries only, never raw bytes. llm-provider records its own
 * per-provider degradations on its log channel.
 *
 * Best-effort: no EventBus means no event, and a publish failure is swallowed
 * into the shared swallow channel (telemetry never fails a turn).
 */
import { Effect } from "effect";
import { EventBus, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { DegradedKernelPart } from "../../assembly/to-llm-messages.js";

/** Publish one `ContentPartDegraded` event per stubbed part. No-op for an empty list. */
export function emitContentPartsDegraded(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly degraded: readonly DegradedKernelPart[];
}): Effect.Effect<void, never> {
  if (args.degraded.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    const bus = busOpt.value;
    yield* Effect.forEach(
      args.degraded,
      (d) =>
        bus
          .publish({
            _tag: "ContentPartDegraded",
            taskId: args.taskId,
            iteration: args.iteration,
            part: d.part,
            role: d.role,
            reason: d.reason,
            timestamp: Date.now(),
          })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "reasoning/src/kernel/utils/content-part-degraded.ts:emitContentPartsDegraded",
                tag: errorTag(err),
              }),
            ),
          ),
      { discard: true },
    );
  });
}
