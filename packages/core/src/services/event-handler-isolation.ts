import { Cause, Effect } from "effect";
import type { AgentEvent, EventHandler } from "../types/agent-event.js";

const deliver = (
  hs: ReadonlyArray<EventHandler>,
  ev: AgentEvent,
  onFailure: (cause: Cause.Cause<never>) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.all(
    hs.map((h) =>
      Effect.suspend(() => h(ev)).pipe(
        Effect.catchAllCause((cause) =>
          // Interrupts propagate: only failures and defects are isolated.
          Cause.isInterruptedOnly(cause)
            ? Effect.failCause(cause)
            : onFailure(cause),
        ),
      ),
    ),
    { concurrency: "unbounded", discard: true },
  );

/**
 * Broadcast `event` to `hs` concurrently with per-handler isolation.
 *
 * A failure or defect in one handler neither interrupts siblings nor fails
 * the publisher. The failure is reported to all handlers as an `ErrorSwallowed`
 * event (site `core/src/services/event-bus.ts:publish`, tag
 * `EventHandlerFailed:<eventTag>`). A handler failing on an `ErrorSwallowed`
 * event (original or report) is dropped silently, so reporting cannot recurse.
 *
 * @param hs — Handlers snapshot to deliver to.
 * @param event — Event being published.
 * @returns Effect that never fails (interrupts still propagate).
 */
export const publishIsolated = (
  hs: ReadonlyArray<EventHandler>,
  event: AgentEvent,
): Effect.Effect<void> =>
  deliver(hs, event, (cause) =>
    event._tag === "ErrorSwallowed"
      ? Effect.void
      : deliver(
          hs,
          {
            _tag: "ErrorSwallowed",
            site: "core/src/services/event-bus.ts:publish",
            tag: `EventHandlerFailed:${event._tag}`,
            message: Cause.pretty(cause).split("\n")[0],
            timestamp: Date.now(),
          },
          () => Effect.void,
        ),
  );
