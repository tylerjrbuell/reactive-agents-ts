import { Clock, Data, Effect } from "effect";
import type { InboundMessage } from "../types.js";

/**
 * Follow-up timers: an agent asks to be woken in a conversation later. A timer is a row in its own
 * store (not the inbox, not a cron schedule); when due, the router enqueues an inbound message for
 * that conversation, so the wake-up passes the same dedupe, access, rate and turn path as every other message.
 * Spec: `wiki/Architecture/Design-Specs/2026-11-16-always-on-gateway-primitives.md` (G3).
 *
 * Bounded: a cap on pending timers per conversation and a maximum horizon. Recurrence stays in cron
 * schedules (gateway). Delivery is at-least-once with dedupe on `timer-<id>`.
 */
export type TimerStatus = "pending" | "fired" | "cancelled";

/** Row count per status. */
export type TimerCounts = Readonly<Record<TimerStatus, number>>;

/** Why a timer operation failed. Drives the tool's answer to the agent. */
export type TimerErrorReason = "invalid" | "in_past" | "too_far" | "too_many" | "store_failed";

/** Typed timer failure. `message` carries classification only, never the note. */
export class TimerError extends Data.TaggedError("TimerError")<{
  readonly reason: TimerErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The conversation a timer wakes, and who may be answered there. Fixed when the session opened. */
export interface TimerBinding {
  readonly adapterId: string;
  readonly platform: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly isGroup: boolean;
  /** Route the timer re-enters (skips the route's `when` filter; access is still checked). */
  readonly routeId: string;
  /** The sender the wake-up counts as; their route role and rate limits apply when it fires. */
  readonly senderId: string;
}

/** One stored timer. */
export interface TimerRow extends TimerBinding {
  readonly id: string;
  /** Epoch ms the timer is due. */
  readonly dueAt: number;
  readonly note: string;
  readonly createdAt: number;
}

/** The timer store port (SQLite behind `makeSqliteRouterStore`, in memory otherwise). */
export interface RouterTimers {
  readonly insert: (row: TimerRow) => Effect.Effect<void, TimerError>;
  readonly countPending: (conversationKey: string) => Effect.Effect<number, TimerError>;
  /** True when a pending timer of that conversation was cancelled. */
  readonly cancel: (id: string, conversationKey: string) => Effect.Effect<boolean, TimerError>;
  readonly pendingFor: (conversationKey: string) => Effect.Effect<ReadonlyArray<TimerRow>, TimerError>;
  /** Pending timers due at `now`, oldest due first. Does not change them. */
  readonly due: (now: number, limit: number) => Effect.Effect<ReadonlyArray<TimerRow>, TimerError>;
  readonly fired: (id: string) => Effect.Effect<void, TimerError>;
  readonly counts: () => Effect.Effect<TimerCounts, TimerError>;
  /** Drop old fired/cancelled rows. Returns rows removed. */
  readonly prune: () => Effect.Effect<number, TimerError>;
}

/** The key one conversation's timers are counted under (same shape as the outbox key). */
export const timerConversationKey = (b: Pick<TimerBinding, "adapterId" | "channelId" | "threadId">): string =>
  `${b.adapterId}:${b.channelId}${b.threadId !== undefined ? `:${b.threadId}` : ""}`;

const MEMORY_DONE_CAP = 1000;

/** In-memory {@link RouterTimers}: bounded and per process; nothing survives a restart. */
export const makeMemoryTimers = (): RouterTimers => {
  const rows = new Map<string, { readonly row: TimerRow; status: TimerStatus }>();
  const key = (r: TimerRow): string => timerConversationKey(r);
  const trim = (): void => {
    let done = 0;
    for (const e of rows.values()) if (e.status !== "pending") done += 1;
    for (const [id, e] of rows) {
      if (done <= MEMORY_DONE_CAP) break;
      if (e.status !== "pending") {
        rows.delete(id);
        done -= 1;
      }
    }
  };
  return {
    insert: (row) => Effect.sync(() => void rows.set(row.id, { row, status: "pending" })),
    countPending: (k) =>
      Effect.sync(() => [...rows.values()].filter((e) => e.status === "pending" && key(e.row) === k).length),
    cancel: (id, k) =>
      Effect.sync(() => {
        const e = rows.get(id);
        if (!e || e.status !== "pending" || key(e.row) !== k) return false;
        e.status = "cancelled";
        trim();
        return true;
      }),
    pendingFor: (k) =>
      Effect.sync(() =>
        [...rows.values()]
          .filter((e) => e.status === "pending" && key(e.row) === k)
          .map((e) => e.row)
          .sort((a, b) => a.dueAt - b.dueAt),
      ),
    due: (now, limit) =>
      Effect.sync(() =>
        [...rows.values()]
          .filter((e) => e.status === "pending" && e.row.dueAt <= now)
          .map((e) => e.row)
          .sort((a, b) => a.dueAt - b.dueAt)
          .slice(0, limit),
      ),
    fired: (id) =>
      Effect.sync(() => {
        const e = rows.get(id);
        if (e && e.status === "pending") e.status = "fired";
        trim();
      }),
    counts: () =>
      Effect.sync(() => {
        const c: Record<TimerStatus, number> = { pending: 0, fired: 0, cancelled: 0 };
        for (const e of rows.values()) c[e.status] += 1;
        return c;
      }),
    prune: () => Effect.succeed(0),
  };
};

// ── The agent-facing port ─────────────────────────────────────────────────

/** A pending timer as the agent sees it. */
export interface FollowUpTimer {
  readonly id: string;
  /** Epoch ms. */
  readonly dueAt: number;
  readonly note: string;
}

/** What the agent may ask for. Exactly one of `at` (ISO 8601 date-time) or `in` (for example `90m`, `2h`, `1d`). */
export interface FollowUpRequest {
  readonly at?: string;
  readonly in?: string;
  readonly note: string;
}

/**
 * The follow-up capability of one conversation (an `OpenSessionRequest.followUp`). Bound to the
 * conversation, route and sender when the session opened: an agent can only set, list and cancel
 * its own conversation's timers.
 */
export interface FollowUpPort {
  readonly schedule: (request: FollowUpRequest) => Effect.Effect<FollowUpTimer, TimerError>;
  readonly cancel: (id: string) => Effect.Effect<boolean, TimerError>;
  readonly pending: () => Effect.Effect<ReadonlyArray<FollowUpTimer>, TimerError>;
}

/** Bounds on follow-ups. */
export interface FollowUpLimits {
  /** Pending timers per conversation. Default 5. */
  readonly maxPending?: number;
  /** Furthest due time from now, ms. Default 7 days. */
  readonly maxHorizonMs?: number;
  /** Nearest due time from now, ms. Default 5 000 (a timer cannot make the agent spin). */
  readonly minDelayMs?: number;
  /** Longest note, characters. Default 500. */
  readonly maxNoteChars?: number;
}

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
};

/** Parse `90s`, `15m`, `2h`, `1d` (also `min`, `hr`, `sec`) into ms; undefined when it is not a duration. */
export const parseFollowUpDelay = (text: string): number | undefined => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d)\s*$/i.exec(text);
  const unit = m?.[2] === undefined ? undefined : UNIT_MS[m[2].toLowerCase()];
  return m?.[1] === undefined || unit === undefined ? undefined : Math.round(Number(m[1]) * unit);
};

/**
 * Timers bound to the store and its limits. `bind` hands the agent a {@link FollowUpPort} for one
 * conversation; the router also calls `due`/`fired` to wake conversations.
 */
export class FollowUpTimers {
  private readonly maxPending: number;
  private readonly maxHorizonMs: number;
  private readonly minDelayMs: number;
  private readonly maxNoteChars: number;

  constructor(
    readonly store: RouterTimers,
    limits: FollowUpLimits = {},
  ) {
    this.maxPending = Math.max(1, Math.floor(limits.maxPending ?? 5));
    this.maxHorizonMs = Math.max(1000, limits.maxHorizonMs ?? 7 * 86_400_000);
    this.minDelayMs = Math.max(0, limits.minDelayMs ?? 5000);
    this.maxNoteChars = Math.max(1, Math.floor(limits.maxNoteChars ?? 500));
  }

  /** The capability for one conversation. */
  bind(binding: TimerBinding): FollowUpPort {
    const store = this.store;
    const key = timerConversationKey(binding);
    const view = (r: TimerRow): FollowUpTimer => ({ id: r.id, dueAt: r.dueAt, note: r.note });
    const limits = this;
    return {
      schedule: (request) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const note = request.note.trim();
          if (note === "" || note.length > limits.maxNoteChars) {
            return yield* Effect.fail(new TimerError({ reason: "invalid", message: `note must be 1 to ${limits.maxNoteChars} characters` }));
          }
          if ((request.at === undefined) === (request.in === undefined)) {
            return yield* Effect.fail(new TimerError({ reason: "invalid", message: "give exactly one of at or in" }));
          }
          const dueAt =
            request.in !== undefined ? now + (parseFollowUpDelay(request.in) ?? Number.NaN) : Date.parse(request.at ?? "");
          if (!Number.isFinite(dueAt)) {
            return yield* Effect.fail(
              new TimerError({ reason: "invalid", message: "in is a duration like 90m, 2h, 1d; at is an ISO 8601 date-time" }),
            );
          }
          if (dueAt - now < limits.minDelayMs) {
            return yield* Effect.fail(new TimerError({ reason: "in_past", message: `due time must be at least ${Math.ceil(limits.minDelayMs / 1000)}s from now` }));
          }
          if (dueAt - now > limits.maxHorizonMs) {
            return yield* Effect.fail(new TimerError({ reason: "too_far", message: `due time must be within ${Math.floor(limits.maxHorizonMs / 3_600_000)}h` }));
          }
          if ((yield* store.countPending(key)) >= limits.maxPending) {
            return yield* Effect.fail(new TimerError({ reason: "too_many", message: `at most ${limits.maxPending} pending follow-ups per conversation` }));
          }
          const row: TimerRow = { ...binding, id: crypto.randomUUID().slice(0, 8), dueAt, note, createdAt: now };
          yield* store.insert(row);
          return view(row);
        }),
      cancel: (id) => store.cancel(id, key),
      pending: () => Effect.map(store.pendingFor(key), (rows) => rows.map(view)),
    };
  }

  /** Timers due now (up to `limit`). */
  due(limit = 50): Effect.Effect<ReadonlyArray<TimerRow>, TimerError> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => this.store.due(now, limit));
  }
}

/** The inbound message a due timer becomes. Id `timer-<id>` is its dedupe key; the note is framed as the agent's own reminder. */
export const timerMessage = (row: TimerRow): InboundMessage => ({
  id: `timer-${row.id}`,
  platform: row.platform,
  channelId: row.channelId,
  senderId: row.senderId,
  content: `Follow-up you scheduled: ${row.note}`,
  metadata: {
    isGroup: row.isGroup,
    // The agent addressed itself; the groups rule must not drop its own reminder.
    mentionsSelf: true,
    ...(row.threadId !== undefined ? { threadId: row.threadId } : {}),
    timer: { id: row.id, routeId: row.routeId, scheduledAt: row.createdAt },
  },
  timestamp: new Date(row.dueAt),
});

/** The route a timer message is pinned to, or undefined for any other message. */
export const timerRouteOf = (msg: InboundMessage): string | undefined => {
  if (!msg.id.startsWith("timer-")) return undefined;
  const t = msg.metadata["timer"];
  if (typeof t !== "object" || t === null) return undefined;
  const routeId = (t as { readonly routeId?: unknown }).routeId;
  return typeof routeId === "string" ? routeId : undefined;
};

// ── The tool definition ───────────────────────────────────────────────────

/** Shape-compatible with the tools package `ToolDefinition` parameters (channels does not depend on tools). */
export interface FollowUpToolParameter {
  readonly name: string;
  readonly type: "string";
  readonly description: string;
  readonly required: boolean;
}

/** A tool definition plus its handler, ready for the runtime to register. */
export interface FollowUpTool {
  readonly name: "follow-up";
  readonly description: string;
  readonly parameters: ReadonlyArray<FollowUpToolParameter>;
  /** Never fails: an error is a result the agent can read and adapt to. */
  readonly execute: (input: Readonly<Record<string, unknown>>) => Effect.Effect<FollowUpToolResult>;
}

/** What the `follow-up` tool returns. */
export type FollowUpToolResult =
  | { readonly ok: true; readonly action: "scheduled"; readonly timer: FollowUpTimer }
  | { readonly ok: true; readonly action: "cancelled"; readonly id: string; readonly found: boolean }
  | { readonly ok: true; readonly action: "list"; readonly timers: ReadonlyArray<FollowUpTimer> }
  | { readonly ok: false; readonly reason: TimerErrorReason; readonly error: string };

const text = (u: unknown): string | undefined => (typeof u === "string" && u.trim() !== "" ? u : undefined);

/**
 * The `follow-up` tool for one conversation: `{ in | at, note }` sets a timer, `{ cancel: id }`
 * cancels one, no arguments lists the pending ones. The runtime registers it from the session's
 * `followUp` port (see `OpenSessionRequest`).
 */
export const makeFollowUpTool = (port: FollowUpPort): FollowUpTool => ({
  name: "follow-up",
  description:
    "Ask to be woken in this conversation later. Set: give `in` (like 90m, 2h, 1d) or `at` (ISO 8601 date-time) plus a `note` saying what to do then. " +
    "Cancel: give `cancel` with a timer id. List: give no arguments. Timers are limited in number and distance; one wake-up runs one turn.",
  parameters: [
    { name: "in", type: "string", description: "Delay from now, for example 90m, 2h or 1d.", required: false },
    { name: "at", type: "string", description: "Absolute time, ISO 8601 (for example 2026-11-20T09:00:00Z).", required: false },
    { name: "note", type: "string", description: "What to do when woken. Written to yourself; keep it short.", required: false },
    { name: "cancel", type: "string", description: "Id of a pending timer to cancel.", required: false },
  ],
  execute: (input) => {
    const fail = (e: TimerError): FollowUpToolResult => ({ ok: false, reason: e.reason, error: e.message });
    const cancel = text(input["cancel"]);
    if (cancel !== undefined) {
      return port.cancel(cancel).pipe(
        Effect.map((found): FollowUpToolResult => ({ ok: true, action: "cancelled", id: cancel, found })),
        Effect.catchAll((e) => Effect.succeed(fail(e))),
      );
    }
    const when = { at: text(input["at"]), in: text(input["in"]) };
    const note = text(input["note"]);
    if (when.at === undefined && when.in === undefined && note === undefined) {
      return port.pending().pipe(
        Effect.map((timers): FollowUpToolResult => ({ ok: true, action: "list", timers })),
        Effect.catchAll((e) => Effect.succeed(fail(e))),
      );
    }
    return port
      .schedule({
        note: note ?? "",
        ...(when.at !== undefined ? { at: when.at } : {}),
        ...(when.in !== undefined ? { in: when.in } : {}),
      })
      .pipe(
        Effect.map((timer): FollowUpToolResult => ({ ok: true, action: "scheduled", timer })),
        Effect.catchAll((e) => Effect.succeed(fail(e))),
      );
  },
});
