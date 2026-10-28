import { Effect, Queue } from "effect";
import { makeChecklistTracker, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { AgentEvent, ChecklistSnapshot } from "@reactive-agents/core";
import type { AgentStreamEvent } from "../stream-types.js";
import type { EbLike } from "./runtime-context.js";

/** Project a checklist snapshot onto the public stream shape. */
export function toChecklistStreamEvent(snapshot: ChecklistSnapshot, iteration: number): AgentStreamEvent {
  return { _tag: "ChecklistUpdated", checklist: snapshot, iteration };
}

const lastIteration = (entries: unknown): number | undefined => {
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const it = (entries[i] as { iteration?: unknown } | null)?.iteration;
    if (typeof it === "number") return it;
  }
  return undefined;
};

/**
 * Feed `LedgerEntryAppended`, `AgentStarted` and `AgentCompleted` into core's
 * `makeChecklistTracker` (the one delegation-tree rule) and offer one
 * `ChecklistUpdated` per visibly changed snapshot. The tracker owns tree
 * membership, so foreign runs on a shared bus never leak in and descendant
 * output is folded into the root snapshot rather than wrapped as
 * `SubAgentActivity`. Subscription failures are swallowed with an
 * observable `ErrorSwallowed` event; this Effect never fails.
 */
export function subscribeChecklistStream(
  eb: EbLike,
  queue: Queue.Queue<AgentStreamEvent>,
  taskId: string,
): Effect.Effect<void, never> {
  const tracker = makeChecklistTracker(taskId);
  let iteration = 0;
  const handle = (event: AgentEvent): Effect.Effect<void, never> =>
    Effect.suspend(() => {
      if (event._tag === "LedgerEntryAppended") {
        const it = lastIteration(event.entries);
        if (it !== undefined && event.taskId === taskId) iteration = it;
      }
      const snapshot = tracker.track(event as never);
      if (snapshot === undefined) return Effect.void;
      return Queue.offer(queue, toChecklistStreamEvent(snapshot, iteration)).pipe(
        Effect.asVoid,
        Effect.catchAll((err) =>
          emitErrorSwallowed({ site: "runtime/src/engine/checklist-stream.ts:offer", tag: errorTag(err) }),
        ),
      );
    });
  const sub = (tag: "LedgerEntryAppended" | "AgentStarted" | "AgentCompleted") =>
    eb.on(tag, handle as never).pipe(
      Effect.asVoid,
      Effect.catchAll((err) =>
        emitErrorSwallowed({ site: `runtime/src/engine/checklist-stream.ts:${tag}-subscribe`, tag: errorTag(err) }),
      ),
    );
  return Effect.all([sub("AgentStarted"), sub("AgentCompleted"), sub("LedgerEntryAppended")], { discard: true });
}
