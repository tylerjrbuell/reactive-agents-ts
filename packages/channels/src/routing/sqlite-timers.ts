import { Clock, Effect } from "effect";
import type { DatabaseLike } from "@reactive-agents/runtime-shim";
import { TimerError, timerConversationKey, type RouterTimers, type TimerCounts, type TimerRow, type TimerStatus } from "./timers.js";

const DAY_MS = 86_400_000;

const failure = (op: string) => (cause: unknown) => new TimerError({ reason: "store_failed", message: `router timers: ${op} failed`, cause });
const num = (u: unknown): number => (typeof u === "number" ? u : 0);
const str = (u: unknown): string => (typeof u === "string" ? u : "");

/** Create the timer table on an open database. */
export const initTimersSchema = (db: DatabaseLike): void => {
  db.exec(`CREATE TABLE IF NOT EXISTS router_timers (
    id TEXT PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_id TEXT,
    is_group INTEGER NOT NULL,
    route_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS router_timers_due ON router_timers (status, due_at)");
  db.exec("CREATE INDEX IF NOT EXISTS router_timers_conversation ON router_timers (conversation_key, status)");
};

const toRow = (raw: unknown): TimerRow => {
  const r = raw as Record<string, unknown>;
  return {
    id: str(r["id"]),
    adapterId: str(r["adapter_id"]),
    platform: str(r["platform"]),
    channelId: str(r["channel_id"]),
    ...(typeof r["thread_id"] === "string" ? { threadId: r["thread_id"] } : {}),
    isGroup: num(r["is_group"]) === 1,
    routeId: str(r["route_id"]),
    senderId: str(r["sender_id"]),
    note: str(r["note"]),
    dueAt: num(r["due_at"]),
    createdAt: num(r["created_at"]),
  };
};

/** A SQLite {@link RouterTimers}: pending timers survive a restart and fire late if due while down. */
export const makeSqliteTimers = (db: DatabaseLike, retentionMs: number = 7 * DAY_MS): RouterTimers => {
  const insert = db.prepare(
    "INSERT INTO router_timers (id, conversation_key, adapter_id, platform, channel_id, thread_id, is_group, route_id, sender_id, note, status, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
  );
  const countPending = db.prepare("SELECT COUNT(*) AS n FROM router_timers WHERE conversation_key = ? AND status = 'pending'");
  const cancel = db.prepare(
    "UPDATE router_timers SET status = 'cancelled', note = '', settled_at = ? WHERE id = ? AND conversation_key = ? AND status = 'pending'",
  );
  const pendingFor = db.prepare("SELECT * FROM router_timers WHERE conversation_key = ? AND status = 'pending' ORDER BY due_at");
  const due = db.prepare("SELECT * FROM router_timers WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?");
  const fired = db.prepare("UPDATE router_timers SET status = 'fired', note = '', settled_at = ? WHERE id = ? AND status = 'pending'");
  const countRows = db.prepare("SELECT status, COUNT(*) AS n FROM router_timers GROUP BY status");
  const prune = db.prepare("DELETE FROM router_timers WHERE status != 'pending' AND settled_at < ?");
  return {
    insert: (row) =>
      Effect.try({
        try: () =>
          void insert.run(
            row.id,
            timerConversationKey(row),
            row.adapterId,
            row.platform,
            row.channelId,
            row.threadId ?? null,
            row.isGroup ? 1 : 0,
            row.routeId,
            row.senderId,
            row.note,
            row.dueAt,
            row.createdAt,
          ),
        catch: failure("insert"),
      }),
    countPending: (key) =>
      Effect.try({ try: () => num((countPending.get(key) as Record<string, unknown> | undefined)?.["n"]), catch: failure("countPending") }),
    cancel: (id, key) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.try({ try: () => cancel.run(now, id, key).changes > 0, catch: failure("cancel") }),
      ),
    pendingFor: (key) => Effect.try({ try: () => pendingFor.all(key).map(toRow), catch: failure("pendingFor") }),
    due: (now, limit) => Effect.try({ try: () => due.all(now, limit).map(toRow), catch: failure("due") }),
    fired: (id) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.try({ try: () => void fired.run(now, id), catch: failure("fired") })),
    counts: () =>
      Effect.try({
        try: (): TimerCounts => {
          const c: Record<TimerStatus, number> = { pending: 0, fired: 0, cancelled: 0 };
          for (const row of countRows.all()) {
            const r = row as Record<string, unknown>;
            const s = str(r["status"]);
            if (s === "pending" || s === "fired" || s === "cancelled") c[s] = num(r["n"]);
          }
          return c;
        },
        catch: failure("counts"),
      }),
    prune: () =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.try({ try: () => prune.run(now - retentionMs).changes, catch: failure("prune") }),
      ),
  };
};
