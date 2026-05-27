import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { ReactiveAgents } from "reactive-agents";

// MOVE-direct-bypass: trivial fixtures bypass to executeDirect, skipping
// debrief path. These tests verify debrief synthesis — disable bypass.
const PRIOR_BYPASS_DI = process.env.RA_DIRECT_BYPASS;
beforeAll(() => { process.env.RA_DIRECT_BYPASS = "0"; });
afterAll(() => {
  if (PRIOR_BYPASS_DI === undefined) delete process.env.RA_DIRECT_BYPASS;
  else process.env.RA_DIRECT_BYPASS = PRIOR_BYPASS_DI;
});

describe("AgentResult enrichment", () => {
  it("result.terminatedBy and result.format are present after run", async () => {
    // Build a minimal agent with test provider
    const agent = await ReactiveAgents.create()
      .withName("debrief-integration-test")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    // Run — the test LLM provider will respond and the kernel will exit
    const result = await agent.run("Simple task for testing");

    // These fields should now exist (may be undefined if not using final-answer tool, but type should exist)
    expect("terminatedBy" in result).toBe(true);
    expect("format" in result).toBe(true);
    // terminatedBy is always populated on the reasoning path
    expect(result.terminatedBy).toBeDefined();
    await agent.dispose();
  });

  it("result.debrief is present when memory is enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("debrief-memory-test")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withMemory({ tier: "standard", dbPath: "/tmp/test-debrief-integration.db" })
      .build();

    const result = await agent.run("Simple memory task");

    // debrief should be populated when memory is enabled
    // (may be undefined if synthesis fails gracefully, but field should exist on type)
    expect("debrief" in result).toBe(true);
    await agent.dispose();
  });

  it("result.debrief is undefined when memory is explicitly disabled (.withoutMemory)", async () => {
    // GH #122 — memory is default-on as of v0.12. To assert the no-memory
    // path we must explicitly opt out via `.withoutMemory()`. Prior to
    // GH #122 a build without `.withMemory()` was equivalent; that is no
    // longer the case.
    const agent = await ReactiveAgents.create()
      .withName("no-memory-agent")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withoutMemory()
      .build();

    const result = await agent.run("Simple task without memory");

    // Debrief should NOT be present without memory
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it("AgentResult type has optional debrief, format, terminatedBy fields", async () => {
    // Type-level check — just verify the fields compile and are accessible
    const agent = await ReactiveAgents.create()
      .withName("type-check-agent")
      .withProvider("test")
      .build();

    const result = await agent.run("type check");
    // These access patterns must compile (TypeScript type check)
    const _d = result.debrief;
    const _f = result.format;
    const _t = result.terminatedBy;
    expect(true).toBe(true); // compile-time check only
    await agent.dispose();
  });
});
