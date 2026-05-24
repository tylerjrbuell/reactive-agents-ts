import { describe, test, expect } from "bun:test";

describe("ReactiveAgent.gatewayStatus()", () => {
  test("returns null when gateway is not configured", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("no-gw-status")
      .withProvider("test")
      .build();

    const status = await agent.gatewayStatus();
    expect(status).toBeNull();
  });

  test("returns GatewayStatus when gateway is configured", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-status")
      .withProvider("test")
      .withGateway({
        heartbeat: { intervalMs: 60000 },
        policies: { dailyTokenBudget: 50000 },
      })
      .build();

    const status = await agent.gatewayStatus();
    expect(status).not.toBeNull();
    expect(status!.isRunning).toBe(false);
    expect(status!.stats).toBeDefined();
    expect(status!.stats.heartbeatsFired).toBe(0);
    expect(typeof status!.uptime).toBe("number");

    await agent.dispose();
  });

  test("status reflects activity after start()/stop() cycle", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("gw-status-active")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 50 },
        policies: { dailyTokenBudget: 100000 },
      })
      .build();

    const handle = agent.start();

    // HS-27 (GH #83): poll until heartbeat counter advances rather than
    // sleeping a fixed 120ms. Fixed sleeps were flake-prone on slow CI.
    const startedAt = Date.now();
    let status = await agent.gatewayStatus();
    while (
      Date.now() - startedAt < 5000 &&
      (!status || status.stats.heartbeatsFired + status.stats.heartbeatsSkipped < 1)
    ) {
      await new Promise((r) => setTimeout(r, 5));
      status = await agent.gatewayStatus();
    }
    expect(status).not.toBeNull();
    expect(status!.stats.heartbeatsFired + status!.stats.heartbeatsSkipped).toBeGreaterThanOrEqual(1);

    await handle.stop();
    await agent.dispose();
  });
});
