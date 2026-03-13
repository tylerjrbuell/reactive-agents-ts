import { describe, test, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder";

describe("SessionStore builder wiring", () => {
  test("session({ persist: true }) is accepted without type error", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("session-test")
      .withProvider("test")
      .withTestResponses({ default: "ok" })
      .build();
    // Should not throw -- session() with persist: true is valid
    const session = agent.session({ persist: true, id: "test-sess" });
    expect(session).toBeDefined();
    await agent.dispose();
  });

  test("session({ persist: false }) works without memory layer", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("no-memory")
      .withProvider("test")
      .withTestResponses({ default: "ok" })
      .build();
    const session = agent.session({ persist: false });
    await session.chat("hello");
    expect(session.history()).toHaveLength(2);
    await agent.dispose();
  });

  test("ReactiveAgentsConfig accepts session field", () => {
    // Type check: ReactiveAgentsConfig schema validates session config
    const { ReactiveAgentsConfigSchema } = require("../src/types");
    const { Schema } = require("effect");
    const result = Schema.decodeUnknownSync(ReactiveAgentsConfigSchema)({
      agentId: "a",
      maxIterations: 10,
      memoryTier: "1",
      enableGuardrails: false,
      enableVerification: false,
      enableCostTracking: false,
      enableAudit: false,
      session: { persist: true, maxAgeDays: 7 },
    });
    expect(result.session?.persist).toBe(true);
    expect(result.session?.maxAgeDays).toBe(7);
  });

  test("session without persist defaults to non-persistent", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("default-session")
      .withProvider("test")
      .withTestResponses({ default: "ok" })
      .build();
    const session = agent.session();
    await session.chat("test");
    await session.end(); // should not throw even without persist
    await agent.dispose();
  });
});
