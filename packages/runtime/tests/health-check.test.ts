import { describe, test, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder";

describe("Health check builder integration", () => {
  test(".withHealthCheck() is chainable", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withHealthCheck();
    expect(result).toBe(builder);
  });

  test("agent.health() returns healthy status with no registered checks", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("health-test")
      .withTestScenario([{ text: "ok" }])
      .withHealthCheck()
      .build();
    const health = await agent.health();
    expect(health.status).toBe("healthy");
    expect(Array.isArray(health.checks)).toBe(true);
    await agent.dispose();
  });

  test("agent.health() works without withHealthCheck() (returns basic healthy)", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("no-health")
      .withTestScenario([{ text: "ok" }])
      .build();
    const health = await agent.health();
    expect(health.status).toBe("healthy");
    expect(health.checks).toHaveLength(0);
    await agent.dispose();
  });

  test("health response includes check details when checks are registered", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("health-detail")
      .withTestScenario([{ text: "ok" }])
      .withHealthCheck()
      .build();
    const health = await agent.health();
    for (const check of health.checks) {
      expect(check.name).toBeTruthy();
      expect(typeof check.healthy).toBe("boolean");
      expect(typeof check.durationMs).toBe("number");
    }
    await agent.dispose();
  });
});
