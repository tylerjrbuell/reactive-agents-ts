import { describe, test, expect } from "bun:test";

// HS-27 (GH #83): waitForGatewayTick polls live status until the heartbeat
// counter advances. Replaces fixed-delay `setTimeout(120)` waits that were
// flaky under slow CI — the test no longer cares how long the loop tick
// takes, only that one fired.
async function waitForGatewayTick(
  agent: { gatewayStatus(): Promise<any> },
  minHeartbeats = 1,
  timeoutMs = 5000,
  pollMs = 5,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await agent.gatewayStatus();
    if (status && status.stats.heartbeatsFired >= minHeartbeats) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Gateway did not fire ${minHeartbeats} heartbeats within ${timeoutMs}ms`);
}

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
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withGateway({
        heartbeat: { intervalMs: 50 },
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    expect(handle.done).toBeInstanceOf(Promise);

    await waitForGatewayTick(agent, 1);

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
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 50 },
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();

    await waitForGatewayTick(agent, 1);

    const stopSummary = await handle.stop();
    const doneSummary = await handle.done;
    expect(stopSummary).toEqual(doneSummary);

    await agent.dispose();
  });

  test("gateway loop increments totalRuns when policy says execute", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-runs")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withGateway({
        heartbeat: { intervalMs: 50 },
        // No budget limits, so adaptive heartbeat should allow at least some executions
      })
      .build();

    const handle = agent.start();

    await waitForGatewayTick(agent, 1);

    const summary = await handle.stop();
    // At least the first heartbeat should execute (adaptive policy allows first heartbeat)
    expect(summary.heartbeatsFired).toBeGreaterThanOrEqual(1);

    await agent.dispose();
  });

  // Suite load can push the gateway-tick → totalRuns latency past Bun's
  // default 5000ms test timeout. 20s gives the polling loop (15s budget)
  // headroom on top of build/import overhead. Bun honours the 3rd `test()`
  // arg as a per-test timeout in ms (see signature at end of arrow).
  test("gateway with persistMemoryAcrossRuns still ticks and executes", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-persist-mem")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 50, instruction: "ping" },
        persistMemoryAcrossRuns: true,
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();
    // Wait until both a heartbeat fires AND totalRuns advances (test asserts run > 0).
    // Generous timeout — under heavy suite load `agent.gatewayStatus()` queues
    // behind in-flight Effect fibers, and the gateway tick competes for runtime
    // budget. 15s ≫ the ~50ms typical first-heartbeat latency.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const status = await agent.gatewayStatus();
      if (status && status.stats.heartbeatsFired >= 1 && status.stats.totalRuns >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const summary = await handle.stop();
    expect(summary.totalRuns).toBeGreaterThanOrEqual(1);
    await agent.dispose();
  }, 20000);
});
