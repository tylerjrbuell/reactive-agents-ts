import { Clock, Effect } from "effect";
import type { RouteSpec } from "./types.js";

const DAY_MS = 86_400_000;

/** Options for {@link makeRouteMeter}. */
export interface RouteMeterOptions {
  /**
   * Worst-case cost in USD reserved before a turn starts (spec 7.5: `maxIterations` x per-iteration
   * max tokens x model price). The resolver's owner knows the model; the meter only enforces.
   * Default 0: no reservation, the cap is checked against settled spend only.
   */
  readonly reserveUsd?: number | ((route: RouteSpec) => number);
  /** Cap on messages per route per day, on top of `RouteSpec.maxCostPerDayUsd`. Default none. */
  readonly maxMessagesPerDay?: number;
}

/** Why the meter refused a turn. `cost` maps to the `budget` drop reason, `messages` to `rate`. */
export type MeterRefusal = "cost" | "messages";

/** Result of {@link RouteMeter.reserve}. */
export type MeterReservation =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly reason: MeterRefusal };

/** Spend and message counters for one route over the last 24 hours. */
export interface RouteMeterSnapshot {
  readonly messages: number;
  /** Settled spend. */
  readonly spentUsd: number;
  /** Worst case held by turns that have not finished. */
  readonly reservedUsd: number;
}

/**
 * Per-route message and cost meter. Deterministic: it reads time only from the Effect `Clock`, so a
 * `TestClock` drives it. A turn first {@link RouteMeter.reserve}s its worst case; on completion
 * {@link RouteMeter.settle} swaps the reservation for the actual cost, and {@link RouteMeter.release}
 * drops it (failed or interrupted turn). Both are idempotent.
 *
 * In-memory: counters are per process and reset on restart (router status reports `durableStore`).
 */
export interface RouteMeter {
  readonly reserve: (route: RouteSpec) => Effect.Effect<MeterReservation>;
  readonly settle: (id: number, actualUsd: number) => Effect.Effect<void>;
  readonly release: (id: number) => Effect.Effect<void>;
  readonly snapshot: (routeId: string) => Effect.Effect<RouteMeterSnapshot>;
}

interface Reservation {
  readonly routeId: string;
  readonly usd: number;
}

/** Create an in-memory {@link RouteMeter}. */
export const makeRouteMeter = (options: RouteMeterOptions = {}): RouteMeter => {
  const messages = new Map<string, number[]>();
  const spend = new Map<string, Array<{ readonly at: number; readonly usd: number }>>();
  const open = new Map<number, Reservation>();
  let next = 0;

  const reserveFor = (route: RouteSpec): number => {
    const r = options.reserveUsd;
    const usd = typeof r === "function" ? r(route) : (r ?? 0);
    return Number.isFinite(usd) && usd > 0 ? usd : 0;
  };
  const liveMessages = (routeId: string, now: number): number[] => {
    const live = (messages.get(routeId) ?? []).filter((t) => now - t < DAY_MS);
    messages.set(routeId, live);
    return live;
  };
  const liveSpend = (routeId: string, now: number) => {
    const live = (spend.get(routeId) ?? []).filter((s) => now - s.at < DAY_MS);
    spend.set(routeId, live);
    return live;
  };
  const reservedFor = (routeId: string): number => {
    let total = 0;
    for (const r of open.values()) if (r.routeId === routeId) total += r.usd;
    return total;
  };

  return {
    reserve: (route) =>
      Effect.map(Clock.currentTimeMillis, (now): MeterReservation => {
        const sent = liveMessages(route.id, now);
        if (options.maxMessagesPerDay !== undefined && sent.length >= options.maxMessagesPerDay) {
          return { ok: false, reason: "messages" };
        }
        const reserve = reserveFor(route);
        if (route.maxCostPerDayUsd !== undefined) {
          const spent = liveSpend(route.id, now).reduce((sum, s) => sum + s.usd, 0);
          const held = spent + reservedFor(route.id);
          // A route that reached its cap is closed even when the next turn reserves nothing.
          if (held >= route.maxCostPerDayUsd || held + reserve > route.maxCostPerDayUsd) {
            return { ok: false, reason: "cost" };
          }
        }
        sent.push(now);
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
          const list = spend.get(held.routeId) ?? [];
          list.push({ at: now, usd: actualUsd });
          spend.set(held.routeId, list);
        }
      }),
    release: (id) => Effect.sync(() => void open.delete(id)),
    snapshot: (routeId) =>
      Effect.map(Clock.currentTimeMillis, (now) => ({
        messages: liveMessages(routeId, now).length,
        spentUsd: liveSpend(routeId, now).reduce((sum, s) => sum + s.usd, 0),
        reservedUsd: reservedFor(routeId),
      })),
  };
};
