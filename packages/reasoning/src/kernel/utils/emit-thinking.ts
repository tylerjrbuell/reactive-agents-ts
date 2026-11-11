// File: src/kernel/utils/emit-thinking.ts
//
// `ThinkingEmitted` publisher, moved verbatim out of diagnostics.ts (2026-11-11)
// to keep that file under the 1,000-LOC new-giant bar. diagnostics.ts
// re-exports both names, so every import path is unchanged.

import { Effect } from "effect";
import { EventBus, emitErrorSwallowed, errorTag } from "@reactive-agents/core";

/** Max chars of readable thinking published on `ThinkingEmitted`. */
export const THINKING_EMIT_MAX = 12_000;

/**
 * Publish the provider's readable thinking channel as ONE `ThinkingEmitted`
 * event (capped at THINKING_EMIT_MAX, `truncated: true` when cut). No event for
 * blank/absent thinking. Best-effort; no-op when no EventBus is ambient.
 */
export function emitThinking(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly thinking: string | undefined;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const thinking = args.thinking;
    if (typeof thinking !== "string" || thinking.trim().length === 0) return;
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    const cut = thinking.length > THINKING_EMIT_MAX;
    yield* busOpt.value
      .publish({
        _tag: "ThinkingEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        content: cut ? thinking.slice(0, THINKING_EMIT_MAX) : thinking,
        ...(cut ? { truncated: true } : {}),
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitThinking",
            tag: errorTag(err),
          }),
        ),
      );
  });
}
