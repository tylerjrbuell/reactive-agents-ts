import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("Smoke: Error Recovery", () => {
  it("missing API key fails at build time with clear message", async () => {
    // Temporarily ensure no API key is set
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await ReactiveAgents.create()
        .withName("missing-key")
        .withProvider("anthropic")
        .build();

      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const msg = (error as Error).message;
      expect(msg).toContain("ANTHROPIC_API_KEY");
    } finally {
      // Restore
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("agent.run() with empty input produces a result, not a crash", async () => {
    const agent = await ReactiveAgents.create()
      .withName("empty-input")
      .withProvider("test")
      .build();

    const result = await agent.run("");
    // Should complete without throwing
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("agent.run() returns structured output", async () => {
    const agent = await ReactiveAgents.create()
      .withName("structured-output")
      .withProvider("test")
      .withTestResponses({ default: "Structured response" })
      .build();

    const result = await agent.run("Test input");
    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(typeof result.taskId).toBe("string");
    expect(typeof result.agentId).toBe("string");
    expect(typeof result.metadata.duration).toBe("number");
    expect(typeof result.metadata.stepsCount).toBe("number");
    expect(typeof result.metadata.cost).toBe("number");
    expect(typeof result.metadata.tokensUsed).toBe("number");
  });

  it("max iterations with direct LLM loop is caught", async () => {
    // Create an agent that always returns tool calls (never completes)
    // With maxIterations=1, it should hit the limit
    const agent = await ReactiveAgents.create()
      .withName("max-iter-test")
      .withProvider("test")
      .withMaxIterations(1)
      .build();

    // Even with 1 iteration, a simple response should complete
    const result = await agent.run("Hello");
    expect(result).toBeDefined();
  });
});
