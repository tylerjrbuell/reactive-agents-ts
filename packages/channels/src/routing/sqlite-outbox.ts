import { Clock, Effect } from "effect";
import type { DatabaseLike } from "@reactive-agents/runtime-shim";
import type { OutboundMessage } from "../adapter.js";
import {
  OutboxError,
  type OutboxCounts,
  type OutboxEntry,
  type OutboxStatus,
  type RouterOutbox,
} from "./outbox.js";

const DAY_MS = 86_400_000;

/** Retention for terminal outbox rows. */
export interface OutboxRetention {
  /** Terminal rows older than this are pruned. Default 7 days. */
  readonly maxAgeMs?: number;
  /** Most terminal rows kept (oldest pruned first). Default 50 000. */
  readonly maxRows?: number;
}

const failure = (op: string) => (cause: unknown) => new OutboxError({ message: `router outbox: ${op} failed`, cause });
const num = (u: unknown): number => (typeof u === "number" ? u : 0);
const str = (u: unknown): string => (typeof u === "string" ? u : "");

/** Text, thread and reply target of a pending message (attachments never stored: such rows are not resumable). */
const encode = (m: OutboundMessage): string =>
  JSON.stringify({
    channelId: m.conversation.channelId,
    ...(m.conversation.threadId !== undefined ? { threadId: m.conversation.threadId } : {}),
    text: m.text,
    ...(m.format !== undefined ? { format: m.format } : {}),
    ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}),
  });

const decode = (json: string): OutboundMessage | undefined => {
  let u: unknown;
  try {
    u = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof u !== "object" || u === null) return undefined;
  const r: Record<string, unknown> = { ...u };
  if (typeof r["channelId"] !== "string" || typeof r["text"] !== "string") return undefined;
  return {
    conversation: { channelId: r["channelId"], ...(typeof r["threadId"] === "string" ? { threadId: r["threadId"] } : {}) },
    text: r["text"],
    ...(r["format"] === "plain" || r["format"] === "markdown" ? { format: r["format"] } : {}),
    ...(typeof r["replyTo"] === "string" ? { replyTo: r["replyTo"] } : {}),
  };
};

/** Create the outbox table on an open database. */
export const initOutboxSchema = (db: DatabaseLike): void => {
  db.exec(`CREATE TABLE IF NOT EXISTS router_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adapter_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    resume INTEGER NOT NULL DEFAULT 0,
    source_key TEXT,
    payload TEXT,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS router_outbox_status ON router_outbox (status, id)");
};

/** A SQLite {@link RouterOutbox} over a database that ran {@link initOutboxSchema}. Terminal rows drop their text. */
export const makeSqliteOutbox = (db: DatabaseLike, retention: OutboxRetention = {}): RouterOutbox => {
  const maxAgeMs = retention.maxAgeMs ?? 7 * DAY_MS;
  const maxRows = retention.maxRows ?? 50_000;
  const insert = db.prepare(
    "INSERT INTO router_outbox (adapter_id, conversation_key, status, resume, source_key, payload, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)",
  );
  const attempted = db.prepare("UPDATE router_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'pending'");
  const sent = db.prepare(
    "UPDATE router_outbox SET status = 'sent', attempts = attempts + 1, payload = NULL, settled_at = ? WHERE id = ? AND status = 'pending'",
  );
  const failed = db.prepare(
    "UPDATE router_outbox SET status = 'failed', last_error = ?, payload = NULL, settled_at = ? WHERE id = ? AND status = 'pending'",
  );
  const pendingRows = db.prepare(
    "SELECT id, adapter_id, attempts, resume, source_key, payload FROM router_outbox WHERE status = 'pending' ORDER BY id",
  );
  const countRows = db.prepare("SELECT status, COUNT(*) AS n FROM router_outbox GROUP BY status");
  const pruneAge = db.prepare("DELETE FROM router_outbox WHERE status != 'pending' AND settled_at < ?");
  const pruneCount = db.prepare(
    "DELETE FROM router_outbox WHERE id IN (SELECT id FROM router_outbox WHERE status != 'pending' ORDER BY id DESC LIMIT -1 OFFSET ?)",
  );
  let enqueued = 0;
  const prune = (): Effect.Effect<number, OutboxError> =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.try({ try: () => pruneAge.run(now - maxAgeMs).changes + pruneCount.run(maxRows).changes, catch: failure("prune") }),
    );
  return {
    enqueue: (input) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.try({
          try: () =>
            Number(insert.run(input.adapterId, input.conversationKey, input.resume ? 1 : 0, input.sourceKey ?? null, encode(input.message), now).lastInsertRowid),
          catch: failure("enqueue"),
        }),
      ).pipe(Effect.tap(() => (++enqueued % 200 === 0 ? Effect.ignore(prune()) : Effect.void))),
    attempted: (id, reason) => Effect.try({ try: () => void attempted.run(reason, id), catch: failure("attempted") }),
    sent: (id) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.try({ try: () => void sent.run(now, id), catch: failure("sent") })),
    failed: (id, reason) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.try({ try: () => void failed.run(reason, now, id), catch: failure("failed") })),
    recover: () =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.try({
          try: (): ReadonlyArray<OutboxEntry> => {
            const out: OutboxEntry[] = [];
            for (const row of pendingRows.all()) {
              const r = row as Record<string, unknown>;
              const id = num(r["id"]);
              const message = decode(str(r["payload"]));
              if (message === undefined) {
                failed.run("unreadable stored message", now, id);
                continue;
              }
              out.push({
                id,
                adapterId: str(r["adapter_id"]),
                message,
                attempts: num(r["attempts"]),
                resume: num(r["resume"]) === 1,
                ...(typeof r["source_key"] === "string" ? { sourceKey: r["source_key"] } : {}),
              });
            }
            return out;
          },
          catch: failure("recover"),
        }),
      ),
    counts: () =>
      Effect.try({
        try: (): OutboxCounts => {
          const c: Record<OutboxStatus, number> = { pending: 0, sent: 0, failed: 0 };
          for (const row of countRows.all()) {
            const r = row as Record<string, unknown>;
            const s = str(r["status"]);
            if (s === "pending" || s === "sent" || s === "failed") c[s] = num(r["n"]);
          }
          return c;
        },
        catch: failure("counts"),
      }),
    prune,
  };
};
