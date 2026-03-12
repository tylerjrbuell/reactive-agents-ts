import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src";

describe("Builder convenience methods", () => {
  test("withTimeout sets execution timeout", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTimeout(5000)
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withRetryPolicy sets retry configuration", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withRetryPolicy({ maxRetries: 3, backoffMs: 1000 })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withCacheTimeout sets semantic cache TTL", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withCacheTimeout(300_000)
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withGuardrails accepts thresholds inline", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withGuardrails({ injection: true, pii: true, thresholds: { injection: 0.9, pii: 0.85 } })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("methods are chainable", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTimeout(5000)
      .withRetryPolicy({ maxRetries: 2, backoffMs: 500 })
      .withCacheTimeout(600_000)
      .withGuardrails({ thresholds: { injection: 0.95 } })
      .withStrictValidation()
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
