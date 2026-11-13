/**
 * The durable half of the channel hub: the framework's `RouterStore`, `AccountLeases` and
 * `RouteMeter` ports over the Cortex SQLite database.
 *
 * Why durable: dedupe, turn caps and the daily spend cap must survive a restart (a restart that
 * reopened the day's budget, or re-ran a redelivered Telegram update, would defeat the router's
 * safety properties). The router reports `durableStore: true` from this store.
 *
 * Fail-closed on load: the store hands the router only routes that decode AND pass the framework
 * `validateRoute` (an `open` route without caps, a webhook route with a user list, a malformed
 * sender key never goes live, even when a row was edited by hand). Rejected rows are listed in
 * {@link DurableRouterStore.rejected} for the status endpoint.
 */
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { Clock, Effect, Either, Schema } from "effect";
import type { Database } from "bun:sqlite";
import {
  ChannelAlreadyOwned,
  RouteSpec,
  validateRoute,
  type AccountLeases,
  type MeterReservation,
  type RouteMeter,
  type RouteMeterOptions,
  type RouteMeterSnapshot,
  type RouterStore,
  type RouteSpecInput,
} from "@reactive-agents/channels";
import { getChannel, listRoutes, replaceRoute, insertRoute, routeToSpecInput, sameRouteInput, type RouteRecord } from "../db/channel-hub-queries.js";

const DAY_MS = 86_400_000;
/** Remembered platform message ids (oldest evicted first). Larger than the in-memory default: it is cheap on disk. */
const SEEN_CAPACITY = 20_000;

/** A route row the store refused to hand to the router, with the plain reason. */
export interface RejectedRoute {
  readonly routeId: string;
  readonly reason: string;
}

/** The framework store plus the rows it held back. */
export interface DurableRouterStore extends RouterStore {
  /** Route rows that did not decode or failed validation on the latest read. */
  readonly rejected: () => readonly RejectedRoute[];
}

const decodeRoute = Schema.decodeUnknownEither(RouteSpec);

/** Routes in the table, decoded and validated; invalid ones are returned as rejections. */
export const loadValidRoutes = (
  db: Database,
): { readonly routes: ReadonlyArray<RouteSpec>; readonly rejected: readonly RejectedRoute[]; readonly records: ReadonlyArray<RouteRecord> } => {
  const records = listRoutes(db);
  const platformOf = (channelId: string): string | undefined => getChannel(db, channelId)?.platform;
  const routes: RouteSpec[] = [];
  const rejected: RejectedRoute[] = [];
  for (const rec of records) {
    const input = routeToSpecInput(rec);
    const decoded = decodeRoute(input);
    if (Either.isLeft(decoded)) {
      rejected.push({ routeId: rec.id, reason: "does not match the RouteSpec schema" });
      continue;
    }
    const problem = validateRoute(decoded.right, platformOf, input.senderTools !== undefined);
    if (problem) {
      rejected.push({ routeId: rec.id, reason: problem.message });
      continue;
    }
    routes.push(decoded.right);
  }
  return { routes, rejected, records };
};

/**
 * `RouterStore` over `cortex_routes`, `cortex_router_seen` and `cortex_router_turns`.
 *
 * `getRoutes` reads the table on every call, so a route edit through the API is live without a
 * router restart. `setRoutes` only inserts or updates (never deletes): the router starts with the
 * subset whose channel could be built, and a delete there would erase routes that are merely
 * inactive. Deleting a route is an explicit API action.
 */
export const makeDurableRouterStore = (db: Database): DurableRouterStore => {
  let rejected: readonly RejectedRoute[] = [];
  return {
    durable: true,
    rejected: () => rejected,
    getRoutes: Effect.sync(() => {
      const loaded = loadValidRoutes(db);
      rejected = loaded.rejected;
      return loaded.routes;
    }),
    setRoutes: (next) =>
      Effect.sync(() => {
        const existing = new Map(listRoutes(db).map((r) => [r.id, r] as const));
        for (const route of next) {
          const input: RouteSpecInput = Schema.encodeSync(RouteSpec)(route);
          const cur = existing.get(route.id);
          if (!cur) insertRoute(db, input);
          else if (!sameRouteInput(routeToSpecInput(cur), input)) replaceRoute(db, input);
        }
      }),
    markSeen: (key) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const inserted = db.prepare("INSERT OR IGNORE INTO cortex_router_seen (key, seen_at) VALUES (?, ?)").run(key, now).changes > 0;
        if (inserted) {
          db.prepare("DELETE FROM cortex_router_seen WHERE seq <= (SELECT MAX(seq) FROM cortex_router_seen) - ?").run(SEEN_CAPACITY);
        }
        return inserted;
      }),
    takeTurn: (bucket, limit, windowMs) =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        db.transaction(() => {
          db.prepare("DELETE FROM cortex_router_turns WHERE bucket = ? AND at <= ?").run(bucket, now - windowMs);
          const row = db.prepare("SELECT COUNT(*) AS n FROM cortex_router_turns WHERE bucket = ?").get(bucket) as { n: number } | null;
          if ((row?.n ?? 0) >= limit) return false;
          db.prepare("INSERT INTO cortex_router_turns (bucket, at) VALUES (?, ?)").run(bucket, now);
          return true;
        })(),
      ),
  };
};

// ─── Account lease ───

/** Options for {@link makeDbLeases}. Time and process liveness are injectable so a test needs no sleeping. */
export interface DbLeaseOptions {
  /** How often a held lease refreshes its heartbeat. Default 10 s. */
  readonly heartbeatMs?: number;
  /** A lease whose heartbeat is older than this is stale (3 missed beats). Default 30 s. */
  readonly staleAfterMs?: number;
  readonly now?: () => number;
  /** Whether a pid is alive on this host; a dead owner's lease is taken over at once. */
  readonly pidAlive?: (pid: number) => boolean;
  /** This process's pid and host (tests simulate a second process). */
  readonly pid?: number;
  readonly host?: string;
}

const defaultPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e && e.code === "EPERM";
  }
};

const fingerprintKey = (fingerprint: string): string => createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);

/** Who holds an account right now: the channel, the process and when it took it. Never the account or its hash. */
export interface LeaseHolder {
  readonly channelId: string;
  readonly pid: number;
  readonly since: number;
}

/** The live leases (a stale one is not listed), for the Channels page's "who owns this account". */
export const listLeaseHolders = (db: Database, staleAfterMs = 30_000, now: () => number = Date.now): readonly LeaseHolder[] =>
  (db.prepare("SELECT channel_id, pid, since FROM cortex_router_leases WHERE heartbeat > ? ORDER BY since").all(now() - staleAfterMs) as { channel_id: string; pid: number; since: number }[]).map(
    (r) => ({ channelId: r.channel_id, pid: r.pid, since: r.since }),
  );

/**
 * One owner per account, enforced in the Cortex database: a row per credential fingerprint (a
 * hash, never the secret) with a heartbeat. A second owner (another process on the same DB, or a
 * second channel with the same credential in this one) fails closed with `ChannelAlreadyOwned`.
 * A lease is stale after 3 missed heartbeats, or at once when its owner's pid is dead on this host.
 */
export const makeDbLeases = (db: Database, options: DbLeaseOptions = {}): AccountLeases => {
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const staleAfterMs = options.staleAfterMs ?? heartbeatMs * 3;
  const now = options.now ?? Date.now;
  const alive = options.pidAlive ?? defaultPidAlive;
  const pid = options.pid ?? process.pid;
  const host = options.host ?? hostname();
  return {
    acquire: (channelId, fingerprint) => {
      const key = fingerprintKey(fingerprint);
      const since = now();
      const take = Effect.suspend(() => {
        const taken = db.transaction((): ChannelAlreadyOwned | undefined => {
          const row = db.prepare("SELECT * FROM cortex_router_leases WHERE fingerprint = ?").get(key) as
            | { pid: number; host: string; since: number; heartbeat: number }
            | null;
          if (row) {
            const stale = since - row.heartbeat > staleAfterMs || (row.host === host && row.pid !== pid && !alive(row.pid));
            if (!stale) return new ChannelAlreadyOwned({ channelId, ownerPid: row.pid, since: row.since });
            db.prepare("DELETE FROM cortex_router_leases WHERE fingerprint = ?").run(key);
          }
          db.prepare("INSERT INTO cortex_router_leases (fingerprint, channel_id, pid, host, since, heartbeat) VALUES (?, ?, ?, ?, ?, ?)").run(
            key,
            channelId,
            pid,
            host,
            since,
            since,
          );
          return undefined;
        })();
        return taken ? Effect.fail(taken) : Effect.void;
      });
      return Effect.acquireRelease(
        Effect.zipRight(
          take,
          Effect.sync(() => {
            const timer = setInterval(() => {
              db.prepare("UPDATE cortex_router_leases SET heartbeat = ? WHERE fingerprint = ? AND pid = ? AND since = ?").run(now(), key, pid, since);
            }, heartbeatMs);
            timer.unref?.();
            return timer;
          }),
        ),
        (timer) =>
          Effect.sync(() => {
            clearInterval(timer);
            db.prepare("DELETE FROM cortex_router_leases WHERE fingerprint = ? AND pid = ? AND since = ?").run(key, pid, since);
          }),
      ).pipe(Effect.asVoid);
    },
  };
};

// ─── Meter ───

/**
 * `RouteMeter` over `cortex_router_turns` (messages per route per day) and `cortex_router_spend`
 * (settled USD). Same contract as the framework's in-memory meter: reserve a worst case before the
 * turn, settle to the actual cost after, release on failure. Reservations live in memory (a turn
 * that was in flight at a restart holds nothing), settled spend and message counts survive a restart.
 */
export const makeDurableRouteMeter = (db: Database, options: RouteMeterOptions = {}): RouteMeter => {
  const open = new Map<number, { readonly routeId: string; readonly usd: number }>();
  let next = 0;
  const bucket = (routeId: string): string => `msgs:${routeId}`;
  const reserveFor = (route: RouteSpec): number => {
    const r = options.reserveUsd;
    const usd = typeof r === "function" ? r(route) : (r ?? 0);
    return Number.isFinite(usd) && usd > 0 ? usd : 0;
  };
  const reservedFor = (routeId: string): number => {
    let total = 0;
    for (const r of open.values()) if (r.routeId === routeId) total += r.usd;
    return total;
  };
  const messages = (routeId: string, at: number): number => {
    db.prepare("DELETE FROM cortex_router_turns WHERE bucket = ? AND at <= ?").run(bucket(routeId), at - DAY_MS);
    const row = db.prepare("SELECT COUNT(*) AS n FROM cortex_router_turns WHERE bucket = ?").get(bucket(routeId)) as { n: number } | null;
    return row?.n ?? 0;
  };
  const spent = (routeId: string, at: number): number => {
    db.prepare("DELETE FROM cortex_router_spend WHERE route_id = ? AND at <= ?").run(routeId, at - DAY_MS);
    const row = db.prepare("SELECT COALESCE(SUM(usd), 0) AS total FROM cortex_router_spend WHERE route_id = ?").get(routeId) as { total: number } | null;
    return row?.total ?? 0;
  };
  return {
    reserve: (route) =>
      Effect.map(Clock.currentTimeMillis, (now): MeterReservation => {
        if (options.maxMessagesPerDay !== undefined && messages(route.id, now) >= options.maxMessagesPerDay) {
          return { ok: false, reason: "messages" };
        }
        const reserve = reserveFor(route);
        if (route.maxCostPerDayUsd !== undefined) {
          const held = spent(route.id, now) + reservedFor(route.id);
          // A route that reached its cap is closed even when the next turn reserves nothing.
          if (held >= route.maxCostPerDayUsd || held + reserve > route.maxCostPerDayUsd) return { ok: false, reason: "cost" };
        }
        db.prepare("INSERT INTO cortex_router_turns (bucket, at) VALUES (?, ?)").run(bucket(route.id), now);
        const id = ++next;
        open.set(id, { routeId: route.id, usd: reserve });
        return { ok: true, id };
      }),
    settle: (id, actualUsd) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const held = open.get(id);
        if (!held) return;
        open.delete(id);
        if (Number.isFinite(actualUsd) && actualUsd > 0) {
          db.prepare("INSERT INTO cortex_router_spend (route_id, at, usd) VALUES (?, ?, ?)").run(held.routeId, now, actualUsd);
        }
      }),
    release: (id) => Effect.sync(() => void open.delete(id)),
    snapshot: (routeId) =>
      Effect.map(
        Clock.currentTimeMillis,
        (now): RouteMeterSnapshot => ({
          messages: messages(routeId, now),
          spentUsd: spent(routeId, now),
          reservedUsd: reservedFor(routeId),
        }),
      ),
  };
};
