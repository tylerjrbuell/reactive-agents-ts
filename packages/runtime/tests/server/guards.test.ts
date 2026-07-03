// packages/runtime/tests/server/guards.test.ts
import { describe, expect, test } from "bun:test";
import { createEndpointGuards, DEFAULT_LIMITS } from "../../src/server/guards.js";

describe("endpoint guards", () => {
  test("rate limit fires after N requests in window and resets after window", () => {
    let now = 0;
    const g = createEndpointGuards({ rateLimit: { requests: 2, window: "1m" } }, () => now);
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    const third = g.checkRunStart("u1");
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.kind).toBe("rateLimit");
    now += 61_000;
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("anonymous cap independent of identified users", () => {
    let now = 0;
    const g = createEndpointGuards({ anonymous: { runs: 1, window: "1h" } }, () => now);
    g.onRunStart(null);
    const second = g.checkRunStart(null);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.kind).toBe("anonymous");
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("concurrency releases on run end", () => {
    const g = createEndpointGuards({ maxConcurrentRunsPerUser: 1 }, () => 0);
    g.onRunStart("u1");
    expect(g.checkRunStart("u1").allowed).toBe(false);
    g.onRunEnd("u1", 0);
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("budget accumulates recorded spend and blocks over cap", () => {
    let now = 0;
    const g = createEndpointGuards({ budgetPerUser: { usd: 0.1, window: "1d" } }, () => now);
    g.onRunStart("u1");
    g.onRunEnd("u1", 0.09);
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    g.onRunEnd("u1", 0.02); // total 0.11 > 0.10
    const blocked = g.checkRunStart("u1");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.kind).toBe("budget");
    now += 24 * 60 * 60 * 1000 + 1;
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("DEFAULT_LIMITS shape", () => {
    expect(DEFAULT_LIMITS.rateLimit).toEqual({ requests: 20, window: "1m" });
    expect(DEFAULT_LIMITS.anonymous).toEqual({ runs: 3, window: "1h" });
    expect(DEFAULT_LIMITS.maxConcurrentRunsPerUser).toBe(2);
    expect(DEFAULT_LIMITS.budgetPerUser).toEqual({ usd: 0.5, window: "1d" });
  });
});
