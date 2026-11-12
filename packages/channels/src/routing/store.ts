import { Clock, Effect } from "effect";
import type { RouteSpec, RouterStore } from "./types.js";

/** Bound on remembered message ids (oldest evicted first). */
const SEEN_CAPACITY = 4096;

/**
 * In-memory {@link RouterStore}. Dedupe and rate counters are per process and reset on restart;
 * `durable` is false and router status says so.
 */
export const makeMemoryRouterStore = (initial: ReadonlyArray<RouteSpec> = []): RouterStore => {
  let routes: ReadonlyArray<RouteSpec> = initial;
  const seen = new Set<string>();
  const turns = new Map<string, number[]>();
  return {
    durable: false,
    getRoutes: Effect.sync(() => routes),
    setRoutes: (next) =>
      Effect.sync(() => {
        routes = next;
      }),
    markSeen: (key) =>
      Effect.sync(() => {
        if (seen.has(key)) return false;
        seen.add(key);
        if (seen.size > SEEN_CAPACITY) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        return true;
      }),
    takeTurn: (bucket, limit, windowMs) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const live = (turns.get(bucket) ?? []).filter((t) => now - t < windowMs);
        if (live.length >= limit) {
          turns.set(bucket, live);
          return false;
        }
        turns.set(bucket, [...live, now]);
        return true;
      }),
  };
};
