import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { InboundMessage } from "../types.js";
import type { InboxCounts, InboxEntry, InboxSettled, RouterInbox } from "./inbox.js";
import type { RouteOutcome } from "./types.js";

/**
 * Typed payloads of the inbox events. They ride the existing `Custom` event
 * (`type` below) until core owns first-class `ChannelInbox*` events. Payloads never carry message text.
 */
export interface InboxEventPayloads {
  /** An orphaned `running` row went back to `received`. */
  readonly "channel.inbox.retried": { readonly adapterId: string; readonly attempts: number };
  /** A row ran out of attempts and is `failed`. */
  readonly "channel.inbox.failed": { readonly adapterId: string; readonly attempts: number; readonly reason: string };
  /** Several envelopes became one turn input (`batchWindowMs`). */
  readonly "channel.inbox.batched": { readonly routeId: string; readonly size: number; readonly sourceIds: ReadonlyArray<string> };
  /** An envelope was folded into a running turn (`midRun: "fold"`). */
  readonly "channel.inbox.folded": { readonly routeId: string; readonly sourceId: string };
  /** A running turn was cancelled for a newer envelope (`midRun: "interrupt"`). */
  readonly "channel.inbox.interrupted": { readonly routeId: string; readonly sourceId: string };
}

/** The `type` of an inbox event. */
export type InboxEventType = keyof InboxEventPayloads;

/** Build the typed event for an inbox transition. */
export const inboxEvent = <T extends InboxEventType>(type: T, payload: InboxEventPayloads[T]): AgentEvent => ({
  _tag: "Custom",
  type,
  payload,
});

/** Settled status for a routing outcome. */
export const settledFor = (outcome: RouteOutcome): { readonly status: InboxSettled; readonly detail?: string } => {
  switch (outcome._tag) {
    case "Answered":
      return { status: "done" };
    case "Failed":
      return { status: "failed", detail: outcome.error.reason };
    case "Dropped":
      return { status: "dropped", detail: outcome.reason };
    case "Denied":
      return { status: "dropped", detail: "denied" };
    case "Unrouted":
      return { status: "dropped", detail: "unrouted" };
    case "Duplicate":
      return { status: "dropped", detail: "duplicate" };
  }
};

/**
 * The engine's view of the inbox. Every call is best effort: a store failure ends as an
 * `ErrorSwallowed` event and the router keeps serving (durability degrades, answers do not stop).
 * With no inbox every call is a no-op, so the in-memory store path is unchanged.
 */
export class InboxTracker {
  constructor(
    private readonly inbox: RouterInbox | undefined,
    private readonly emit: (event: AgentEvent) => Effect.Effect<void>,
  ) {}

  get enabled(): boolean {
    return this.inbox !== undefined;
  }

  private guard<A>(site: string, fallback: A, run: (inbox: RouterInbox) => Effect.Effect<A, unknown>): Effect.Effect<A> {
    const inbox = this.inbox;
    if (!inbox) return Effect.succeed(fallback);
    return run(inbox).pipe(
      Effect.catchAll((error) =>
        Effect.as(emitErrorSwallowed({ site: `channels/src/routing/inbox-tracker.ts:${site}`, tag: errorTag(error) }), fallback),
      ),
    );
  }

  /** True when the envelope is new. A failing store accepts (fail open: answer now, lose durability for this one). */
  accept(key: string, adapterId: string, msg: InboundMessage): Effect.Effect<boolean> {
    return this.guard("accept", true, (i) => i.accept(key, adapterId, msg));
  }

  begin(keys: ReadonlyArray<string>): Effect.Effect<void> {
    return this.guard("start", undefined, (i) => i.start(keys));
  }

  settle(keys: ReadonlyArray<string>, outcome: RouteOutcome): Effect.Effect<void> {
    const { status, detail } = settledFor(outcome);
    return this.guard("settle", undefined, (i) => i.settle(keys, status, detail));
  }

  counts(): Effect.Effect<InboxCounts | undefined> {
    return this.guard<InboxCounts | undefined>("counts", undefined, (i) => i.counts());
  }

  /**
   * Startup: return orphaned rows to `received` (or fail them when out of attempts), report both,
   * prune old rows, then hand back the entries to run again, oldest first.
   */
  recover(): Effect.Effect<ReadonlyArray<InboxEntry>> {
    const self = this;
    return Effect.gen(function* () {
      const recovered = yield* self.guard("recover", undefined, (i) => i.recover());
      for (const r of recovered?.requeued ?? []) {
        yield* self.emit(inboxEvent("channel.inbox.retried", { adapterId: r.adapterId, attempts: r.attempts }));
      }
      for (const r of recovered?.exhausted ?? []) {
        yield* self.emit(
          inboxEvent("channel.inbox.failed", { adapterId: r.adapterId, attempts: r.attempts, reason: "attempts-exhausted" }),
        );
      }
      yield* self.guard("prune", 0, (i) => i.prune());
      return yield* self.guard<ReadonlyArray<InboxEntry>>("pending", [], (i) => i.pending());
    });
  }
}
