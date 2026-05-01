import { describe, test, expect } from "bun:test";

describe("Builder .withGateway()", () => {
  test("builder accepts gateway config without error", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const builder = ReactiveAgents.create()
      .withName("test-gateway-agent")
      .withProvider("test")
      .withGateway({
        heartbeat: { intervalMs: 1800000, policy: "adaptive" },
        crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
        policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
      });
    expect(builder).toBeDefined();
  });

  test("gateway config flows through to runtime", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("test-gw")
      .withTestScenario([{ text: "Gateway test response." }])
      .withGateway({
        heartbeat: { intervalMs: 60000 },
        policies: { dailyTokenBudget: 10000 },
      })
      .build();
    expect(agent).toBeDefined();
    const result = await agent.run("test");
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  test("gateway channels accepts mode and sessionTtlDays", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const builder = ReactiveAgents.create()
      .withName("test-gw-chat")
      .withProvider("test")
      .withGateway({
        channels: {
          accessPolicy: "allowlist",
          allowedSenders: ["+15551234567"],
          mode: "chat",
          sessionTtlDays: 14,
        },
      });
    expect(builder).toBeDefined();
  });

  test("gateway channels mode defaults work when omitted", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const builder = ReactiveAgents.create()
      .withName("test-gw-default-mode")
      .withProvider("test")
      .withGateway({ channels: { accessPolicy: "open" } });
    expect(builder).toBeDefined();
  });
});
