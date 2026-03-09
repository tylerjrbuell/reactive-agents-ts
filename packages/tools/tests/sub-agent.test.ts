// File: tests/sub-agent.test.ts
import { describe, it, expect } from "bun:test";
import {
  createSubAgentExecutor,
  buildParentContextPrefix,
  MAX_RECURSION_DEPTH,
  MAX_PARENT_CONTEXT_CHARS,
} from "../src/adapters/agent-tool-adapter.js";
import type { SubAgentConfig, SubAgentResult, ParentContext } from "../src/adapters/agent-tool-adapter.js";

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
    expect(result.summary.length).toBeLessThanOrEqual(1201); // 1200 + "…"
    expect(result.summary).toContain("…");
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

  // ─── Parent Context Forwarding ───

  it("forwards parent context as system prompt prefix", async () => {
    let capturedOpts: any;
    const parentCtx: ParentContext = {
      toolResults: [
        { toolName: "web-search", result: "Found 5 results about reactive agents" },
      ],
      taskDescription: "Research reactive agent frameworks",
    };
    const executor = createSubAgentExecutor(
      { name: "ctx-agent" },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 10 }; },
      0,
      () => parentCtx,
    );
    await executor("summarize findings");
    expect(capturedOpts.systemPrompt).toContain("PARENT CONTEXT");
    expect(capturedOpts.systemPrompt).toContain("web-search");
    expect(capturedOpts.systemPrompt).toContain("Found 5 results");
    expect(capturedOpts.systemPrompt).toContain("Research reactive agent frameworks");
  });

  it("composes parent context with existing system prompt", async () => {
    let capturedOpts: any;
    const parentCtx: ParentContext = {
      toolResults: [{ toolName: "http-get", result: "200 OK" }],
    };
    const executor = createSubAgentExecutor(
      { name: "composed-agent", systemPrompt: "You are a researcher." },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 10 }; },
      0,
      () => parentCtx,
    );
    await executor("analyze data");
    // Parent context comes first, then config system prompt
    expect(capturedOpts.systemPrompt).toContain("PARENT CONTEXT");
    expect(capturedOpts.systemPrompt).toContain("You are a researcher.");
    const parentIdx = capturedOpts.systemPrompt.indexOf("PARENT CONTEXT");
    const configIdx = capturedOpts.systemPrompt.indexOf("You are a researcher.");
    expect(parentIdx).toBeLessThan(configIdx);
  });

  it("works without parent context (backward compat)", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "no-ctx-agent", systemPrompt: "Be concise." },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 10 }; },
      0,
      // No parentContextProvider
    );
    await executor("do something");
    expect(capturedOpts.systemPrompt).toBe("Be concise.");
  });

  it("works when parentContextProvider returns undefined", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "undef-ctx-agent", systemPrompt: "Help me." },
      async (opts) => { capturedOpts = opts; return { output: "ok", success: true, tokensUsed: 10 }; },
      0,
      () => undefined,
    );
    await executor("do something");
    expect(capturedOpts.systemPrompt).toBe("Help me.");
  });
});

describe("buildParentContextPrefix", () => {
  it("returns empty string for undefined context", () => {
    expect(buildParentContextPrefix(undefined)).toBe("");
  });

  it("returns empty string for empty context", () => {
    expect(buildParentContextPrefix({ toolResults: [], workingMemory: [] })).toBe("");
  });

  it("includes tool results", () => {
    const prefix = buildParentContextPrefix({
      toolResults: [
        { toolName: "web-search", result: "Found 3 articles" },
        { toolName: "file-read", result: "File contents here" },
      ],
    });
    expect(prefix).toContain("PARENT CONTEXT");
    expect(prefix).toContain("web-search: Found 3 articles");
    expect(prefix).toContain("file-read: File contents here");
  });

  it("includes working memory", () => {
    const prefix = buildParentContextPrefix({
      workingMemory: ["User prefers JSON output", "API key is valid"],
    });
    expect(prefix).toContain("Working memory:");
    expect(prefix).toContain("User prefers JSON output");
    expect(prefix).toContain("API key is valid");
  });

  it("includes task description", () => {
    const prefix = buildParentContextPrefix({
      taskDescription: "Analyze the codebase for security issues",
    });
    expect(prefix).toContain("Parent task: Analyze the codebase");
  });

  it("truncates individual tool results to 200 chars", () => {
    const longResult = "x".repeat(300);
    const prefix = buildParentContextPrefix({
      toolResults: [{ toolName: "big-tool", result: longResult }],
    });
    // The result should be truncated to 200 chars + "..."
    expect(prefix).not.toContain("x".repeat(201));
    expect(prefix).toContain("...");
  });

  it("truncates total output to MAX_PARENT_CONTEXT_CHARS", () => {
    const manyResults = Array.from({ length: 50 }, (_, i) => ({
      toolName: `tool-${i}`,
      result: "A".repeat(100),
    }));
    const prefix = buildParentContextPrefix({ toolResults: manyResults });
    expect(prefix.length).toBeLessThanOrEqual(MAX_PARENT_CONTEXT_CHARS);
    expect(prefix).toContain("...");
  });
});
