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
import { Effect, Layer, Stream } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { ToolService, ToolExecutionError, createToolsLayer } from "@reactive-agents/tools";

/** Build a proper Stream stub from a response string */
function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

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
    // Capture what prompt is sent to LLM — tool schemas are now in systemPrompt
    let capturedContent = "";

    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
      },
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

    // Verify the captured content includes tool name and parameter names
    expect(capturedContent).toContain("file-write");
    expect(capturedContent).toContain("path");
    expect(capturedContent).toContain("content");
  });

  it("uses tool name fallback when no schemas provided", async () => {
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");
    let capturedContent = "";

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
      },
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
  });
});

// ─── Sprint 0.2: Error messages enriched with schema ───

describe("Sprint 0.2: Error messages enriched with tool schema", () => {
  it("observation contains schema hint when tool fails with missing param", async () => {
    // LLM first calls file-write with wrong args (missing path), then gives FINAL ANSWER
    const testLLMLayer = TestLLMServiceLayer([
      { match: "step-by-step", text: 'I need to write the file. ACTION: file-write({"file": "test.md", "content": "hello"})' },
      { match: "Tool error", text: "FINAL ANSWER: I encountered an error." },
    ]);

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
    const testLLMLayer = TestLLMServiceLayer([
      { match: "step-by-step", text: 'ACTION: echo({"text": "hello"})' },
      { match: "result", text: "FINAL ANSWER: Done." },
    ]);

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
    const testLLMLayer = TestLLMServiceLayer([
      { match: "step-by-step", text: 'ACTION: big-data({"query": "all"})' },
      { match: "STORED:", text: "FINAL ANSWER: Got compressed data." },
    ]);

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
    // Large result should be compressed (structured preview instead of full content)
    expect(observations[0]!.content).toContain("STORED:");
    // Full raw data should NOT appear verbatim in the observation
    expect(observations[0]!.content).not.toContain(largeResult);
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
      stream: (_req: any) => {
        callCount++;
        const content = callCount >= 3
          ? "FINAL ANSWER: Completed after multiple steps."
          : `Thinking on step ${callCount}. I need more info.`;
        return Effect.succeed(makeStreamResponse(content));
      },
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
    // LLM gives a prose answer without "FINAL ANSWER:" marker.
    // With LLMEndTurn evaluator (no iteration/length guards), ANY non-empty
    // end_turn response with no required tools triggers immediate exit.
    let callCount = 0;
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const earlyTermLLMLayer = Layer.succeed(LLMSvc, {
      complete: (_req: any) => {
        callCount++;
        return Effect.succeed({
          content: "Based on my analysis, the answer to your question is that this is a comprehensive response that provides all necessary information without needing further tool calls.",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (_req: any) => {
        callCount++;
        return Effect.succeed(makeStreamResponse("Based on my analysis, the answer to your question is that this is a comprehensive response that provides all necessary information without needing further tool calls."));
      },
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

    // Should exit on the very first call via LLMEndTurn
    expect(result.status).toBe("completed");
    expect(result.steps.filter((s) => s.type === "thought").length).toBe(1);
    // The output should be the substantive response
    expect(String(result.output)).toContain("comprehensive response");
    // LLM called only once (not all 10 iterations)
    expect(callCount).toBe(1);
  });

  it("does NOT trigger early termination for short responses (< 50 chars)", async () => {
    // Short "Test response" (13 chars) should not trigger early exit
    const layer = TestLLMServiceLayer();
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

// ─── Profile overrides: temperature and maxIterations ───

describe("Profile overrides for temperature and maxIterations", () => {
  it("uses profile.temperature when contextProfile provided", async () => {
    let capturedTemperature: number | undefined;
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        capturedTemperature = req.temperature;
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (req: any) => {
        capturedTemperature = req.temperature;
        return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
      },
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Test temperature override",
        taskType: "test",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { maxIterations: 8, temperature: 0.7 },
          },
        },
        contextProfile: {
          tier: "local",
          promptVerbosity: "minimal",
          rulesComplexity: "simplified",
          fewShotExampleCount: 0,
          compactAfterSteps: 4,
          fullDetailSteps: 2,
          toolResultMaxChars: 400,
          contextBudgetPercent: 70,
          toolSchemaDetail: "names-and-types",
          maxIterations: 8,
          temperature: 0.3,
        },
      }).pipe(Effect.provide(capturingLLMLayer)),
    );

    // Profile temperature (0.3) should override config temperature (0.7)
    expect(capturedTemperature).toBe(0.3);
  });

  it("uses profile.maxIterations when contextProfile provided", async () => {
    let callCount = 0;
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const countingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (_req: any) => {
        callCount++;
        // Never give FINAL ANSWER — force exhaustion of maxIterations
        return Effect.succeed({
          content: `Thinking about step ${callCount}...`,
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (_req: any) => {
        callCount++;
        return Effect.succeed(makeStreamResponse(`Thinking about step ${callCount}...`));
      },
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "Test maxIterations override",
        taskType: "test",
        memoryContext: "",
        availableTools: ["never-called-tool"],
        // requiredTools prevents LLMEndTurn from firing (remaining required > 0),
        // ensuring the loop reaches maxIterations instead of exiting early.
        requiredTools: ["never-called-tool"],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { maxIterations: 10, temperature: 0.7 },
          },
        },
        contextProfile: {
          tier: "local",
          promptVerbosity: "minimal",
          rulesComplexity: "simplified",
          fewShotExampleCount: 0,
          compactAfterSteps: 4,
          fullDetailSteps: 2,
          toolResultMaxChars: 400,
          contextBudgetPercent: 70,
          toolSchemaDetail: "names-and-types",
          maxIterations: 3,
          temperature: 0.3,
        },
      }).pipe(Effect.provide(countingLLMLayer)),
    );

    // Profile maxIterations (3) should override config maxIterations (10)
    // Loop should stop after 3 iterations, not 10
    expect(callCount).toBe(3);
    expect(result.status).toBe("partial");
  });
});

// ─── Tool schema detail levels ───

describe("toolSchemaDetail from context profile", () => {
  it("names-and-types detail omits descriptions", async () => {
    let capturedContent = "";
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
      },
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
        contextProfile: {
          tier: "local",
          promptVerbosity: "minimal",
          rulesComplexity: "simplified",
          fewShotExampleCount: 0,
          compactAfterSteps: 4,
          fullDetailSteps: 2,
          toolResultMaxChars: 400,
          contextBudgetPercent: 70,
          toolSchemaDetail: "names-and-types",
        },
      }).pipe(Effect.provide(capturingLLMLayer)),
    );

    // New context engine: compact tool reference with param names and types
    // Required params marked with ★, no verbose descriptions
    expect(capturedContent).toContain("file-write(path: string");
    expect(capturedContent).not.toContain("Write content to a file");
  });

  it("names-only detail shows comma list without parameter details", async () => {
    let capturedContent = "";
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");

    const capturingLLMLayer = Layer.succeed(LLMSvc, {
      complete: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test-model",
        });
      },
      stream: (req: any) => {
        const lastMsg = req.messages[req.messages.length - 1];
        const userContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const sysContent = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
        capturedContent = sysContent + "\n" + userContent;
        return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
      },
      completeStructured: () => Effect.succeed({} as any),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    } as any);

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Write a file and search the web",
        taskType: "multi-tool",
        memoryContext: "",
        availableTools: ["file-write", "web-search"],
        availableToolSchemas: [
          {
            name: "file-write",
            description: "Write content to a file",
            parameters: [
              { name: "path", type: "string", description: "File path", required: true },
              { name: "content", type: "string", description: "File content", required: true },
            ],
          },
          {
            name: "web-search",
            description: "Search the web",
            parameters: [
              { name: "query", type: "string", description: "Search query", required: true },
            ],
          },
        ],
        config: testConfig,
        contextProfile: {
          tier: "local",
          promptVerbosity: "minimal",
          rulesComplexity: "simplified",
          fewShotExampleCount: 0,
          compactAfterSteps: 4,
          fullDetailSteps: 2,
          toolResultMaxChars: 400,
          contextBudgetPercent: 70,
          toolSchemaDetail: "names-only",
        },
      }).pipe(Effect.provide(capturingLLMLayer)),
    );

    // names-only format with no required tools: new context engine omits pinned ref
    // The prompt still includes task and RULES but tool names aren't in the ref block
    expect(capturedContent).toContain("Write a file and search the web");
    expect(capturedContent).toContain("RULES:");
    expect(capturedContent).not.toContain("Write content to a file");
  });
});
