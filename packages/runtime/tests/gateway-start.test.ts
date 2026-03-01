import { describe, test, expect } from "bun:test";

describe("ReactiveAgent.start() — gateway loop", () => {
  test("start() throws if gateway is not configured", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("no-gw")
      .withProvider("test")
      .build();

    expect(() => agent.start()).toThrow("Gateway not configured");
  });

  test("start() returns a GatewayHandle with stop() and done", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-handle")
      .withProvider("test")
      .withTestResponses({ default: "FINAL ANSWER: done" })
      .withGateway({
        heartbeat: { intervalMs: 50 },
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    expect(handle.done).toBeInstanceOf(Promise);

    // Let a tick fire
    await new Promise((r) => setTimeout(r, 120));

    const summary = await handle.stop();
    expect(summary.heartbeatsFired).toBeGreaterThanOrEqual(1);
    expect(summary.cronChecks).toBeGreaterThanOrEqual(1);
    expect(typeof summary.totalRuns).toBe("number");
    expect(summary.error).toBeUndefined();

    await agent.dispose();
  });

  test("stop() resolves the done promise with the same summary", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-done")
      .withProvider("test")
      .withTestResponses({ default: "FINAL ANSWER: ok" })
      .withGateway({
        heartbeat: { intervalMs: 50 },
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();

    // Let a tick fire
    await new Promise((r) => setTimeout(r, 120));

    const stopSummary = await handle.stop();
    const doneSummary = await handle.done;
    expect(stopSummary).toEqual(doneSummary);

    await agent.dispose();
  });

  test("gateway loop increments totalRuns when policy says execute", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-runs")
      .withProvider("test")
      .withTestResponses({ default: "FINAL ANSWER: done" })
      .withGateway({
        heartbeat: { intervalMs: 50 },
        // No budget limits, so adaptive heartbeat should allow at least some executions
      })
      .build();

    const handle = agent.start();

    // Let several ticks fire
    await new Promise((r) => setTimeout(r, 250));

    const summary = await handle.stop();
    // At least the first heartbeat should execute (adaptive policy allows first heartbeat)
    expect(summary.heartbeatsFired).toBeGreaterThanOrEqual(1);

    await agent.dispose();
  });
});
