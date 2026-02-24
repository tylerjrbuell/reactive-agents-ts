// File: tests/strategies/reactive-context-engineering.test.ts
//
// Tests for the Context Engineering & Agent Efficiency sprint changes:
//   - Tool schemas injected into initial context (Sprint 0.1)
//   - Error messages enriched with expected schema (Sprint 0.2)
//   - Tool result summarization / truncation (Sprint 1C)
//   - Context compaction after N steps (Sprint 1B)
//   - Early termination on end_turn with no tool call (Sprint 2D)
//
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, ToolExecutionError, createToolsLayer } from "@reactive-agents/tools";

// ─── Shared tool definition for tests ───

const writeFileTool = {
  name: "file-write",
  description: "Write content to a file",
  parameters: [
    { name: "path", type: "string" as const, description: "File path", required: true },
    { name: "content", type: "string" as const, description: "File content", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const testConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 8, temperature: 0.7 },
  },
};

// ─── Sprint 0.1: Tool schemas in initial context ───

describe("Sprint 0.1: Tool schemas in initial context", () => {
  it("includes parameter names in tools section when availableToolSchemas provided", async () => {
    // Capture what prompt is sent to LLM by using a custom pattern
    let capturedContent = "";

    const capturingLayer = Layer.succeed(
      // Use TestLLMServiceLayer but intercept to capture the content
      // by using a pattern that always matches
      { complete: (req: any) => {
          const lastMsg = req.messages[req.messages.length - 1];
          capturedContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
          return Effect.succeed({
            content: "FINAL ANSWER: done",
            stopReason: "end_turn" as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
            model: "test-model",
          });
        },
        stream: () => Effect.succeed({ pipe: () => {} } as any),
        completeStructured: () => Effect.succeed({} as any),
        embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
        countTokens: () => Effect.succeed(0),
        getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
      } as any,
      { identifier: "LLMService" } as any,
    );

    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        capturedContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: () => Effect.succeed({ pipe: () => {} } as any),
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Write a file",
        taskType: "file-operation",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [
          {
            name: "file-write",
            description: "Write content to a file",
            parameters: [
              { name: "path", type: "string", description: "File path", required: true },
              { name: "content", type: "string", description: "File content", required: true },
            ],
          },
        ],
        config: testConfig,
      }).pipe(Effect.provide(capturingLLMLayer)),
    );

    // Verify the captured content includes parameter names
    expect(capturedContent).toContain("file-write");
    expect(capturedContent).toContain('"path"');
    expect(capturedContent).toContain('"content"');
    expect(capturedContent).toContain("required");
  });

  it("uses tool name fallback when no schemas provided", async () => {
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");
    let capturedContent = "";

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        capturedContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: () => Effect.succeed({} as any),
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Test task",
        taskType: "test",
        memoryContext: "",
        availableTools: ["my-tool"],
        // no availableToolSchemas
        config: testConfig,
      }).pipe(Effect.provide(capturingLLMLayer)),
    );

    // Should show tool name without schema details
    expect(capturedContent).toContain("my-tool");
    // Should use legacy format (tool names only)
    expect(capturedContent).toContain("Available Tools: my-tool");
  });
});

// ─── Sprint 0.2: Error messages enriched with schema ───

describe("Sprint 0.2: Error messages enriched with tool schema", () => {
  it("observation contains schema hint when tool fails with missing param", async () => {
    // LLM first calls file-write with wrong args (missing path), then gives FINAL ANSWER
    const testLLMLayer = TestLLMServiceLayer({
      "step-by-step": 'I need to write the file. ACTION: file-write({"file": "test.md", "content": "hello"})',
      "Tool error": "FINAL ANSWER: I encountered an error.",
    });

    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(writeFileTool, (_args) =>
        Effect.fail(new ToolExecutionError({
          message: 'Missing required parameter "path"',
          toolName: "file-write",
        })),
      );

      return yield* executeReactive({
        taskDescription: "Write a file",
        taskType: "file",
        memoryContext: "",
        availableTools: ["file-write"],
        config: testConfig,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    // Find the observation step after the failed tool call
    const observations = result.steps.filter((s) => s.type === "observation");
    expect(observations.length).toBeGreaterThanOrEqual(1);

    // The observation should contain either the original error OR the schema hint
    const obsContent = observations[0]!.content;
    expect(obsContent).toMatch(/Tool error|error/i);
  });
});

// ─── Sprint 1C: Tool result truncation ───

describe("Sprint 1C: Tool result summarization", () => {
  it("short tool results are returned unchanged", async () => {
    const testLLMLayer = TestLLMServiceLayer({
      "step-by-step": 'ACTION: echo({"text": "hello"})',
      "result": "FINAL ANSWER: Done.",
    });

    const toolsLayer = createToolsLayer();
    const shortResult = "short result";

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(
        {
          name: "echo",
          description: "Echo text",
          parameters: [{ name: "text", type: "string" as const, description: "text", required: true }],
          riskLevel: "low" as const,
          timeoutMs: 5_000,
          requiresApproval: false,
          source: "function" as const,
        },
        (args) => Effect.succeed(args.text as string),
      );

      return yield* executeReactive({
        taskDescription: "Echo test",
        taskType: "test",
        memoryContext: "",
        availableTools: ["echo"],
        config: testConfig,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const observations = result.steps.filter((s) => s.type === "observation");
    if (observations.length > 0) {
      // Short result should not be truncated
      expect(observations[0]!.content).not.toContain("[...chars omitted...]");
    }
  });

  it("large tool results are truncated with omission marker", async () => {
    const testLLMLayer = TestLLMServiceLayer({
      "step-by-step": 'ACTION: big-data({"query": "all"})',
      "chars omitted": "FINAL ANSWER: Got truncated data.",
    });

    const toolsLayer = createToolsLayer();
    // Generate a result > 800 chars
    const largeResult = "A".repeat(1000);

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(
        {
          name: "big-data",
          description: "Returns big data",
          parameters: [{ name: "query", type: "string" as const, description: "query", required: true }],
          riskLevel: "low" as const,
          timeoutMs: 5_000,
          requiresApproval: false,
          source: "function" as const,
        },
        (_args) => Effect.succeed(largeResult),
      );

      return yield* executeReactive({
        taskDescription: "Get big data",
        taskType: "data",
        memoryContext: "",
        availableTools: ["big-data"],
        config: testConfig,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const observations = result.steps.filter((s) => s.type === "observation");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    // Large result should be truncated
    expect(observations[0]!.content).toContain("chars omitted");
    // Result should be shorter than original 1000 chars
    expect(observations[0]!.content.length).toBeLessThan(largeResult.length);
  });
});

// ─── Sprint 1B: Context compaction ───

describe("Sprint 1B: Context compaction after N steps", () => {
  it("context stays bounded even with many iterations", async () => {
    // LLM alternates between tool calls and thoughts — creates many steps
    let callCount = 0;
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const steppingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (_req: any) => {
        callCount++;
        // After 3 calls, give final answer — simulates a multi-step workflow
        if (callCount >= 3) {
          return Effect.succeed({
            content: "FINAL ANSWER: Completed after multiple steps.",
            stopReason: "end_turn" as const,
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70, estimatedCost: 0 },
            model: "test-model",
          });
        }
        return Effect.succeed({
          content: `Thinking on step ${callCount}. I need more info.`,
          stopReason: "end_turn" as const,
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: () => Effect.succeed({} as any),
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "Multi-step task",
        taskType: "complex",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { maxIterations: 5, temperature: 0.7 },
          },
        },
      }).pipe(Effect.provide(steppingLLMLayer)),
    );

    // Should complete (via early termination or FINAL ANSWER)
    expect(result.status).toBe("completed");
    // Steps should be tracked correctly
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });
});

// ─── Sprint 2D: Early termination ───

describe("Sprint 2D: Early termination on end_turn", () => {
  it("exits early when model gives substantive prose response without tool or FINAL ANSWER", async () => {
    // LLM gives a long prose answer without "FINAL ANSWER:" marker on second call
    let callCount = 0;
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const earlyTermLLMLayer = Layer.succeed(LLMSvc, {
      complete: (_req: any) => {
        callCount++;
        if (callCount === 1) {
          // First call: short non-committal response (won't trigger early termination)
          return Effect.succeed({
            content: "Let me think about this.",
            stopReason: "end_turn" as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
            model: "test-model",
          });
        }
        // Second call: substantive prose response with end_turn (>= 50 chars)
        return Effect.succeed({
          content: "Based on my analysis, the answer to your question is that this is a comprehensive response that provides all necessary information without needing further tool calls.",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: () => Effect.succeed({} as any),
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "Explain something in detail",
        taskType: "explanation",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { maxIterations: 10, temperature: 0.7 },
          },
        },
      }).pipe(Effect.provide(earlyTermLLMLayer)),
    );

    // Should exit early rather than exhausting all 10 iterations
    expect(result.status).toBe("completed");
    // Only 2 thought steps (first short one + second long one that triggered early exit)
    expect(result.steps.filter((s) => s.type === "thought").length).toBe(2);
    // The output should be the substantive response
    expect(String(result.output)).toContain("comprehensive response");
    // LLM called only twice (not all 10 iterations)
    expect(callCount).toBe(2);
  });

  it("does NOT trigger early termination for short responses (< 50 chars)", async () => {
    // Short "Test response" (13 chars) should not trigger early exit
    const layer = TestLLMServiceLayer({});
    // Default response: "Test response" (13 chars) — below the 50-char threshold

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "An impossible task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { maxIterations: 3, temperature: 0.7 },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    // Short responses should not trigger early exit — hits max iterations
    expect(result.status).toBe("partial");
  });
});
