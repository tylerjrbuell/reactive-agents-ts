// File: tests/sub-agent.test.ts
import { describe, it, expect } from "bun:test";
import {
  createSubAgentExecutor,
  MAX_RECURSION_DEPTH,
} from "../src/adapters/agent-tool-adapter.js";
import type { SubAgentConfig, SubAgentResult } from "../src/adapters/agent-tool-adapter.js";

describe("createSubAgentExecutor", () => {
  it("returns structured SubAgentResult", async () => {
    // At max depth, should return failure without calling executeFn
    const executor = createSubAgentExecutor(
      { name: "test-agent" },
      async () => { throw new Error("Should not be called"); },
      MAX_RECURSION_DEPTH,
    );

    const result = await executor("do something");
    expect(result.subAgentName).toBe("test-agent");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("recursion depth");
    expect(result.tokensUsed).toBe(0);
  });

  it("enforces MAX_RECURSION_DEPTH", async () => {
    const executor = createSubAgentExecutor(
      { name: "deep-agent" },
      async () => { throw new Error("no"); },
      3, // depth = 3 = MAX_RECURSION_DEPTH
    );
    const result = await executor("test");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Maximum agent recursion depth");
  });

  it("catches executeFn errors gracefully", async () => {
    const executor = createSubAgentExecutor(
      { name: "broken-agent" },
      async () => { throw new Error("Runtime creation failed"); },
      0,
    );
    const result = await executor("test task");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Runtime creation failed");
  });

  it("truncates long summaries to 1500 chars", async () => {
    const executor = createSubAgentExecutor(
      { name: "verbose-agent" },
      async () => ({
        output: "x".repeat(2000),
        success: true,
        tokensUsed: 500,
      }),
      0,
    );
    const result = await executor("test");
    expect(result.success).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(1503); // 1500 + "..."
    expect(result.summary).toContain("...");
  });

  it("config fields are optional except name", () => {
    const config: SubAgentConfig = { name: "minimal" };
    expect(config.name).toBe("minimal");
    expect(config.provider).toBeUndefined();
    expect(config.model).toBeUndefined();
    expect(config.tools).toBeUndefined();
    expect(config.maxIterations).toBeUndefined();
  });

  it("uses default maxIterations of 5 when not specified", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "default-iter" },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 0 }; },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(5);
  });

  it("respects custom maxIterations", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "custom-iter", maxIterations: 3 },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 0 }; },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(3);
  });

  it("passes provider and model to executeFn", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "custom", provider: "openai", model: "gpt-4o" },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 0 }; },
      0,
    );
    await executor("test");
    expect(capturedOpts.provider).toBe("openai");
    expect(capturedOpts.model).toBe("gpt-4o");
  });

  it("passes task to executeFn", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "task-test" },
      async (opts) => { capturedOpts = opts; return { output: "done", success: true, tokensUsed: 10 }; },
      0,
    );
    await executor("summarize this document");
    expect(capturedOpts.task).toBe("summarize this document");
  });

  it("returns success result from executeFn", async () => {
    const executor = createSubAgentExecutor(
      { name: "success-agent" },
      async () => ({ output: "The answer is 42", success: true, tokensUsed: 100 }),
      0,
    );
    const result = await executor("what is the answer?");
    expect(result.subAgentName).toBe("success-agent");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("The answer is 42");
    expect(result.tokensUsed).toBe(100);
  });
});
