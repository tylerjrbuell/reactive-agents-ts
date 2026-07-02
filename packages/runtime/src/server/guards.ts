// packages/runtime/src/server/guards.ts
/**
 * In-memory wallet/abuse guards for public agent endpoints.
 * LIMITATION (documented, v1): counters are per-process. Multi-instance
 * deployments need a shared store — planned, not built (see gap log).
 */
export type Window = "1m" | "1h" | "1d";
const WINDOW_MS: Record<Window, number> = { "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };

export interface EndpointLimits {
  readonly rateLimit?: { readonly requests: number; readonly window: Window };
  readonly anonymous?: { readonly runs: number; readonly window: Window };
  readonly maxConcurrentRunsPerUser?: number;
  readonly budgetPerUser?: { readonly usd: number; readonly window: Window };
}

export const DEFAULT_LIMITS: EndpointLimits = {
  rateLimit: { requests: 20, window: "1m" },
  anonymous: { runs: 3, window: "1h" },
  maxConcurrentRunsPerUser: 2,
  budgetPerUser: { usd: 0.5, window: "1d" },
};

export type GuardDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly kind: "rateLimit" | "budget" | "concurrency" | "anonymous";
      readonly retryAfterMs?: number;
    };

export interface EndpointGuards {
  checkRunStart(userId: string | null): GuardDecision;
  onRunStart(userId: string | null): void;
  onRunEnd(userId: string | null, costUsd: number): void;
}

const ANON = " anonymous";

export const createEndpointGuards = (
  limits: EndpointLimits,
  clock: () => number = () => Date.now(),
): EndpointGuards => {
  const requestTimes = new Map<string, number[]>();
  const spends = new Map<string, Array<{ at: number; usd: number }>>();
  const concurrent = new Map<string, number>();

  const prune = <T extends number | { at: number }>(arr: T[], windowMs: number, now: number): T[] => {
    const cutoff = now - windowMs;
    return arr.filter((x) => (typeof x === "number" ? x : x.at) > cutoff);
  };

  return {
    checkRunStart(userId) {
      const now = clock();
      const key = userId ?? ANON;

      if (userId === null && limits.anonymous) {
        const times = prune(requestTimes.get(ANON) ?? [], WINDOW_MS[limits.anonymous.window], now);
        requestTimes.set(ANON, times);
        if (times.length >= limits.anonymous.runs) {
          return { allowed: false, kind: "anonymous", retryAfterMs: WINDOW_MS[limits.anonymous.window] };
        }
      }

      if (limits.rateLimit) {
        const times = prune(requestTimes.get(key) ?? [], WINDOW_MS[limits.rateLimit.window], now);
        requestTimes.set(key, times);
        if (times.length >= limits.rateLimit.requests) {
          return { allowed: false, kind: "rateLimit", retryAfterMs: WINDOW_MS[limits.rateLimit.window] };
        }
      }

      if (limits.maxConcurrentRunsPerUser !== undefined) {
        if ((concurrent.get(key) ?? 0) >= limits.maxConcurrentRunsPerUser) {
          return { allowed: false, kind: "concurrency" };
        }
      }

      if (limits.budgetPerUser) {
        const entries = prune(spends.get(key) ?? [], WINDOW_MS[limits.budgetPerUser.window], now);
        spends.set(key, entries);
        const total = entries.reduce((s, e) => s + e.usd, 0);
        if (total >= limits.budgetPerUser.usd) {
          return { allowed: false, kind: "budget", retryAfterMs: WINDOW_MS[limits.budgetPerUser.window] };
        }
      }

      return { allowed: true };
    },

    onRunStart(userId) {
      const now = clock();
      const key = userId ?? ANON;
      requestTimes.set(key, [...(requestTimes.get(key) ?? []), now]);
      concurrent.set(key, (concurrent.get(key) ?? 0) + 1);
    },

    onRunEnd(userId, costUsd) {
      const now = clock();
      const key = userId ?? ANON;
      concurrent.set(key, Math.max(0, (concurrent.get(key) ?? 0) - 1));
      if (costUsd > 0) spends.set(key, [...(spends.get(key) ?? []), { at: now, usd: costUsd }]);
    },
  };
};
