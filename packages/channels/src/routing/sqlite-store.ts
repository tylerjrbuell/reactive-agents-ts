import { Clock, Effect, type Scope } from "effect";
import { Database } from "@reactive-agents/runtime-shim";
import {
  InboxError,
  decodeInboxMessage,
  encodeInboxMessage,
  type InboxCounts,
  type InboxEntry,
  type InboxRecovery,
  type InboxStatus,
  type RouterInbox,
} from "./inbox.js";
import type { RouterOutbox } from "./outbox.js";
import type { RouterTimers } from "./timers.js";
import { initOutboxSchema, makeSqliteOutbox } from "./sqlite-outbox.js";
import { initTimersSchema, makeSqliteTimers } from "./sqlite-timers.js";
import type { RouteSpec, RouterStore } from "./types.js";

const DAY_MS = 86_400_000;
const PRUNE_EVERY = 200;

/** Options for {@link makeSqliteRouterStore}. */
export interface SqliteRouterStoreOptions {
  /** Database file, or `":memory:"` for a throwaway one. */
  readonly path: string;
  /** Routes the store starts with (the router replaces them from its own config). */
  readonly routes?: ReadonlyArray<RouteSpec>;
  /** Terminal rows older than this are pruned. Default 7 days. */
  readonly retentionMaxAgeMs?: number;
  /** Most terminal rows kept (oldest pruned first). Default 50 000. */
  readonly retentionMaxRows?: number;
  /** Attempts a message gets before it is `failed` (counted when a turn starts). Default 3. */
  readonly maxAttempts?: number;
  /**
   * A `running` row older than this at startup is treated as orphaned. Default 0: one account lease
   * guarantees a single router per inbox, so every `running` row found at start belongs to a dead
   * process. Raise it only when several processes share one file.
   */
  readonly leaseTtlMs?: number;
}

/** A {@link RouterStore} whose accepted envelopes, dedupe keys and turn counters survive a restart. */
export interface SqliteRouterStore extends RouterStore {
  readonly inbox: RouterInbox;
  readonly outbox: RouterOutbox;
  readonly timers: RouterTimers;
  /** Close the database. Idempotent callers should call it once, after the router's scope closed. */
  readonly close: Effect.Effect<void>;
}

const failure = (op: string) => (cause: unknown) => new InboxError({ message: `router inbox: ${op} failed`, cause });

const num = (u: unknown): number => (typeof u === "number" ? u : 0);
const str = (u: unknown): string => (typeof u === "string" ? u : "");

/**
 * Open a SQLite-backed {@link RouterStore} through the runtime-shim `Database` (bun:sqlite or
 * node:sqlite). Explicit opt-in: pass it as `createChannelRouter({ store })` or
 * `.withChannels({ store })`. The router then recovers orphaned turns at start, retries them up to
 * `maxAttempts`, and reports `durableStore: true` plus inbox counts. Call `close` when done; use
 * {@link makeSqliteRouterStore} to close with a scope instead.
 */
export const openSqliteRouterStore = (
  options: SqliteRouterStoreOptions,
): Effect.Effect<SqliteRouterStore, InboxError> =>
  Effect.try({
      try: () => {
        const db = new Database(options.path);
        if (options.path !== ":memory:") {
          db.exec("PRAGMA journal_mode = WAL");
          db.exec("PRAGMA synchronous = NORMAL");
        }
        db.exec(`CREATE TABLE IF NOT EXISTS router_inbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          adapter_id TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          payload TEXT,
          received_at INTEGER NOT NULL,
          leased_at INTEGER,
          settled_at INTEGER
        )`);
        db.exec("CREATE INDEX IF NOT EXISTS router_inbox_status ON router_inbox (status, seq)");
        db.exec("CREATE TABLE IF NOT EXISTS router_turns (bucket TEXT NOT NULL, at INTEGER NOT NULL)");
        db.exec("CREATE INDEX IF NOT EXISTS router_turns_bucket ON router_turns (bucket, at)");
        initOutboxSchema(db);
        initTimersSchema(db);
        return db;
      },
      catch: failure("open"),
  }).pipe(
    Effect.map((db) => {
      const maxAttempts = options.maxAttempts ?? 3;
      const leaseTtlMs = options.leaseTtlMs ?? 0;
      const maxAgeMs = options.retentionMaxAgeMs ?? 7 * DAY_MS;
      const maxRows = options.retentionMaxRows ?? 50_000;

      const insert = db.prepare(
        "INSERT OR IGNORE INTO router_inbox (key, adapter_id, status, payload, received_at) VALUES (?, ?, 'received', ?, ?)",
      );
      const insertSeen = db.prepare(
        "INSERT OR IGNORE INTO router_inbox (key, adapter_id, status, received_at, settled_at) VALUES (?, '', 'done', ?, ?)",
      );
      const start = db.prepare(
        "UPDATE router_inbox SET attempts = attempts + CASE WHEN status = 'received' THEN 1 ELSE 0 END, status = 'running', leased_at = CASE WHEN status = 'received' THEN ? ELSE leased_at END WHERE key = ? AND status IN ('received', 'running')",
      );
      const settle = db.prepare(
        "UPDATE router_inbox SET status = ?, last_error = ?, payload = NULL, settled_at = ? WHERE key = ? AND status IN ('received', 'running')",
      );
      const orphans = db.prepare("SELECT key, adapter_id, attempts FROM router_inbox WHERE status = 'running' AND leased_at <= ?");
      const requeue = db.prepare("UPDATE router_inbox SET status = 'received', leased_at = NULL WHERE key = ?");
      const exhaust = db.prepare(
        "UPDATE router_inbox SET status = 'failed', last_error = ?, payload = NULL, settled_at = ? WHERE key = ?",
      );
      const pendingRows = db.prepare("SELECT key, adapter_id, attempts, payload FROM router_inbox WHERE status = 'received' ORDER BY seq");
      const countRows = db.prepare("SELECT status, COUNT(*) AS n FROM router_inbox GROUP BY status");
      const pruneAge = db.prepare(
        "DELETE FROM router_inbox WHERE status IN ('done', 'failed', 'dropped') AND settled_at < ?",
      );
      const pruneCount = db.prepare(
        "DELETE FROM router_inbox WHERE seq IN (SELECT seq FROM router_inbox WHERE status IN ('done', 'failed', 'dropped') ORDER BY seq DESC LIMIT -1 OFFSET ?)",
      );
      const pruneTurns = db.prepare("DELETE FROM router_turns WHERE at < ?");
      const turnsDrop = db.prepare("DELETE FROM router_turns WHERE bucket = ? AND at < ?");
      const turnsCount = db.prepare("SELECT COUNT(*) AS n FROM router_turns WHERE bucket = ?");
      const turnsAdd = db.prepare("INSERT INTO router_turns (bucket, at) VALUES (?, ?)");

      const recoverTx = db.transaction((cutoff: number, now: number): InboxRecovery => {
        const requeued: Array<{ key: string; adapterId: string; attempts: number }> = [];
        const exhausted: Array<{ key: string; adapterId: string; attempts: number }> = [];
        for (const row of orphans.all(cutoff)) {
          const r = row as Record<string, unknown>;
          const item = { key: str(r["key"]), adapterId: str(r["adapter_id"]), attempts: num(r["attempts"]) };
          if (item.attempts >= maxAttempts) {
            exhaust.run(`orphaned after ${item.attempts} attempts`, now, item.key);
            exhausted.push(item);
          } else {
            requeue.run(item.key);
            requeued.push(item);
          }
        }
        return { requeued, exhausted };
      });

      let accepted = 0;
      const prune = (): Effect.Effect<number, InboxError> =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.try({
            try: () => {
              const byAge = pruneAge.run(now - maxAgeMs).changes;
              const byCount = pruneCount.run(maxRows).changes;
              pruneTurns.run(now - DAY_MS);
              return byAge + byCount;
            },
            catch: failure("prune"),
          }),
        );

      const inbox: RouterInbox = {
        accept: (key, adapterId, message) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({
              try: () => insert.run(key, adapterId, encodeInboxMessage(message), now).changes > 0,
              catch: failure("accept"),
            }),
          ).pipe(
            Effect.tap((fresh) => (fresh && ++accepted % PRUNE_EVERY === 0 ? Effect.ignore(prune()) : Effect.void)),
          ),
        start: (keys) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({ try: () => void keys.forEach((k) => start.run(now, k)), catch: failure("start") }),
          ),
        settle: (keys, status, detail) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({
              try: () => void keys.forEach((k) => settle.run(status, detail ?? null, now, k)),
              catch: failure("settle"),
            }),
          ),
        recover: () =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({ try: () => recoverTx(now - leaseTtlMs, now), catch: failure("recover") }),
          ),
        pending: () =>
          Effect.try({
            try: (): ReadonlyArray<InboxEntry> => {
              const out: InboxEntry[] = [];
              for (const row of pendingRows.all()) {
                const r = row as Record<string, unknown>;
                const message = decodeInboxMessage(str(r["payload"]));
                if (message) {
                  out.push({ key: str(r["key"]), adapterId: str(r["adapter_id"]), message, attempts: num(r["attempts"]) });
                } else {
                  // An unreadable stored message is failed, not run and not retried forever.
                  settle.run("failed", "unreadable stored message", Date.now(), str(r["key"]));
                }
              }
              return out;
            },
            catch: failure("pending"),
          }),
        counts: () =>
          Effect.try({
            try: (): InboxCounts => {
              const c: Record<InboxStatus, number> = { received: 0, running: 0, done: 0, failed: 0, dropped: 0 };
              for (const row of countRows.all()) {
                const r = row as Record<string, unknown>;
                const status = str(r["status"]);
                if (status === "received" || status === "running" || status === "done" || status === "failed" || status === "dropped") {
                  c[status] = num(r["n"]);
                }
              }
              return c;
            },
            catch: failure("counts"),
          }),
        prune,
      };

      let routes: ReadonlyArray<RouteSpec> = options.routes ?? [];
      const store: SqliteRouterStore = {
        durable: true,
        inbox,
        outbox: makeSqliteOutbox(db, { maxAgeMs, maxRows }),
        timers: makeSqliteTimers(db, maxAgeMs),
        close: Effect.sync(() => db.close()),
        getRoutes: Effect.sync(() => routes),
        setRoutes: (next) =>
          Effect.sync(() => {
            routes = next;
          }),
        markSeen: (key) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({ try: () => insertSeen.run(key, now, now).changes > 0, catch: failure("markSeen") }),
          ).pipe(Effect.orDie),
        takeTurn: (bucket, limit, windowMs) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.try({
              try: () => {
                turnsDrop.run(bucket, now - windowMs);
                const used = num((turnsCount.get(bucket) as Record<string, unknown> | undefined)?.["n"]);
                if (used >= limit) return false;
                turnsAdd.run(bucket, now);
                return true;
              },
              catch: failure("takeTurn"),
            }),
          ).pipe(Effect.orDie),
      };
      return store;
    }),
  );

/** {@link openSqliteRouterStore}, closed when the scope closes. */
export const makeSqliteRouterStore = (
  options: SqliteRouterStoreOptions,
): Effect.Effect<SqliteRouterStore, InboxError, Scope.Scope> =>
  Effect.acquireRelease(openSqliteRouterStore(options), (store) => store.close);
