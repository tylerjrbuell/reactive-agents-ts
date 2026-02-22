// Tests for Sprint 1 & 2 foundation integration (C1-C5, H1-H3, H5)
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Mock LLM Service ───

const makeMockLLM = (opts?: {
  toolCalls?: unknown[];
  content?: string;
  tokenCount?: number;
}) => {
  const tokenCount = opts?.tokenCount ?? 30;
  return Layer.succeed(
    Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        stopReason: string;
        toolCalls?: unknown[];
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCost: number;
        };
        model: string;
      }>;
    }>("LLMService"),
    {
      complete: (_req: unknown) =>
        Effect.succeed({
          content: opts?.content ?? "Task completed.",
          stopReason: opts?.toolCalls?.length ? "tool_use" : "end_turn",
          toolCalls: opts?.toolCalls ?? [],
          usage: {
            inputTokens: Math.floor(tokenCount / 2),
            outputTokens: Math.floor(tokenCount / 2),
            totalTokens: tokenCount,
            estimatedCost: tokenCount * 0.00001,
          },
          model: "test-model",
        }),
    },
  );
};

// ─── Helpers ───

const mockTask = {
  id: "task-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

const makeTestLayer = (llmLayer: Layer.Layer<any, any>, config = defaultReactiveAgentsConfig("agent-001")) => {
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
  );
  return Layer.mergeAll(hookLayer, engineLayer, llmLayer);
};

// ─── C5: Token Tracking ───

describe("C5: Token Tracking", () => {
  it("should accumulate tokensUsed from LLM responses", async () => {
    const testLayer = makeTestLayer(makeMockLLM({ tokenCount: 42 }));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBe(42);
  });

  it("should accumulate tokens across multiple iterations", async () => {
    let callCount = 0;
    const llmLayer = Layer.succeed(
      Context.GenericTag<{
        complete: (req: unknown) => Effect.Effect<{
          content: string;
          stopReason: string;
          toolCalls?: unknown[];
          usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            estimatedCost: number;
          };
          model: string;
        }>;
      }>("LLMService"),
      {
        complete: (_req: unknown) => {
          callCount++;
          // First call returns a tool call, second returns end_turn
          if (callCount === 1) {
            return Effect.succeed({
              content: "Calling a tool",
              stopReason: "tool_use",
              toolCalls: [{ id: "call-1", name: "test_tool", input: {} }],
              usage: {
                inputTokens: 10,
                outputTokens: 10,
                totalTokens: 20,
                estimatedCost: 0.001,
              },
              model: "test-model",
            });
          }
          return Effect.succeed({
            content: "Done",
            stopReason: "end_turn",
            toolCalls: [],
            usage: {
              inputTokens: 15,
              outputTokens: 15,
              totalTokens: 30,
              estimatedCost: 0.002,
            },
            model: "test-model",
          });
        },
      },
    );

    const testLayer = makeTestLayer(llmLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // Should accumulate 20 + 30 = 50 tokens
    expect(result.metadata.tokensUsed).toBe(50);
  });
});

// ─── C4: Tool Definition Type Adapter ───

describe("C4: Tool Definition Type Adapter", () => {
  it("should pass tools to LLM when ToolService is available", async () => {
    let receivedTools: unknown = undefined;
    const llmLayer = Layer.succeed(
      Context.GenericTag<{
        complete: (req: unknown) => Effect.Effect<{
          content: string;
          stopReason: string;
          toolCalls?: unknown[];
          usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            estimatedCost: number;
          };
          model: string;
        }>;
      }>("LLMService"),
      {
        complete: (req: unknown) => {
          receivedTools = (req as any).tools;
          return Effect.succeed({
            content: "Done",
            stopReason: "end_turn",
            toolCalls: [],
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, estimatedCost: 0 },
            model: "test-model",
          });
        },
      },
    );

    // Mock ToolService that returns tools in function-calling format
    const mockToolService = Layer.succeed(
      Context.GenericTag<{
        toFunctionCallingFormat: () => Effect.Effect<readonly any[]>;
        listTools: () => Effect.Effect<readonly any[]>;
        execute: (input: any) => Effect.Effect<any>;
        register: (def: any, handler: any) => Effect.Effect<void>;
        connectMCPServer: (config: any) => Effect.Effect<any>;
        disconnectMCPServer: (name: string) => Effect.Effect<void>;
        getTool: (name: string) => Effect.Effect<any>;
        listMCPServers: () => Effect.Effect<readonly any[]>;
      }>("ToolService"),
      {
        toFunctionCallingFormat: () =>
          Effect.succeed([
            {
              name: "search",
              description: "Search the web",
              input_schema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ]),
        listTools: () =>
          Effect.succeed([{ name: "search", description: "Search the web" }]),
        execute: () => Effect.succeed({ toolName: "search", success: true, result: "result", executionTimeMs: 0 }),
        register: () => Effect.void,
        connectMCPServer: () => Effect.succeed({} as any),
        disconnectMCPServer: () => Effect.void,
        getTool: () => Effect.succeed({} as any),
        listMCPServers: () => Effect.succeed([]),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(llmLayer),
      mockToolService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // Verify tools were passed to LLM
    expect(receivedTools).toBeDefined();
    expect(Array.isArray(receivedTools)).toBe(true);
    const tools = receivedTools as any[];
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("search");
  });
});

// ─── H1: Observability Integration ───

describe("H1: Observability Integration", () => {
  it("should call ObservabilityService spans when available", async () => {
    const spanLog: string[] = [];

    const mockObs = Layer.succeed(
      Context.GenericTag<{
        withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
        info: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
        debug: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
        warn: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
        error: (message: string, error?: unknown, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
        log: (level: string, message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
        incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
        recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
        setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
        getMetrics: (filter?: any) => Effect.Effect<readonly any[], never>;
        getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string }, never>;
        captureSnapshot: (agentId: string, state: any) => Effect.Effect<any, never>;
        getSnapshots: (agentId: string, limit?: number) => Effect.Effect<readonly any[], never>;
        flush: () => Effect.Effect<void, any>;
      }>("ObservabilityService"),
      {
        withSpan: (name, effect) => {
          spanLog.push(name);
          return effect;
        },
        info: (_msg) => Effect.void,
        debug: (_msg) => Effect.void,
        warn: (_msg) => Effect.void,
        error: (_msg) => Effect.void,
        log: (_level, _msg) => Effect.void,
        incrementCounter: () => Effect.void,
        recordHistogram: () => Effect.void,
        setGauge: () => Effect.void,
        getMetrics: () => Effect.succeed([]),
        getTraceContext: () => Effect.succeed({ traceId: "t1", spanId: "s1" }),
        captureSnapshot: () => Effect.succeed({} as any),
        getSnapshots: () => Effect.succeed([]),
        flush: () => Effect.void,
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockLLM()),
      mockObs,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // Should have spans for each phase
    expect(spanLog.some(s => s.includes("bootstrap"))).toBe(true);
    expect(spanLog.some(s => s.includes("think"))).toBe(true);
    expect(spanLog.some(s => s.includes("complete"))).toBe(true);
  });
});

// ─── H2: Stub Phases ───

describe("H2: Stub Phases Wired", () => {
  it("should call GuardrailService.check() when guardrails enabled", async () => {
    let guardrailCalled = false;

    const config = {
      ...defaultReactiveAgentsConfig("agent-001"),
      enableGuardrails: true,
    };

    const mockGuardrail = Layer.succeed(
      Context.GenericTag<{
        check: (text: string) => Effect.Effect<{ passed: boolean; violations: any[]; score: number; checkedAt: Date }>;
        checkOutput: (text: string) => Effect.Effect<{ passed: boolean; violations: any[]; score: number; checkedAt: Date }>;
        getConfig: () => Effect.Effect<any>;
      }>("GuardrailService"),
      {
        check: (_text) => {
          guardrailCalled = true;
          return Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() });
        },
        checkOutput: (_text) => Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() }),
        getConfig: () => Effect.succeed({}),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockLLM(), config),
      mockGuardrail,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(guardrailCalled).toBe(true);
  });

  it("should fail with GuardrailViolationError when check fails", async () => {
    const config = {
      ...defaultReactiveAgentsConfig("agent-001"),
      enableGuardrails: true,
    };

    const failingGuardrail = Layer.succeed(
      Context.GenericTag<{
        check: (text: string) => Effect.Effect<{ passed: boolean; violations: any[]; score: number; checkedAt: Date }>;
        checkOutput: (text: string) => Effect.Effect<{ passed: boolean; violations: any[]; score: number; checkedAt: Date }>;
        getConfig: () => Effect.Effect<any>;
      }>("GuardrailService"),
      {
        check: (_text) =>
          Effect.succeed({
            passed: false,
            violations: [{ type: "injection", severity: "critical", message: "Injection detected" }],
            score: 0,
            checkedAt: new Date(),
          }),
        checkOutput: (_text) => Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() }),
        getConfig: () => Effect.succeed({}),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockLLM(), config),
      failingGuardrail,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("GuardrailViolationError");
    }
  });

  it("should call VerificationService.verify() when verification enabled", async () => {
    let verifyCalled = false;

    const config = {
      ...defaultReactiveAgentsConfig("agent-001"),
      enableVerification: true,
    };

    const mockVerification = Layer.succeed(
      Context.GenericTag<{
        verify: (response: string, input: string) => Effect.Effect<{
          overallScore: number;
          passed: boolean;
          riskLevel: string;
          layerResults: any[];
          recommendation: string;
          verifiedAt: Date;
        }>;
        getConfig: () => Effect.Effect<any>;
      }>("VerificationService"),
      {
        verify: (_response, _input) => {
          verifyCalled = true;
          return Effect.succeed({
            overallScore: 0.9,
            passed: true,
            riskLevel: "low",
            layerResults: [],
            recommendation: "accept",
            verifiedAt: new Date(),
          });
        },
        getConfig: () => Effect.succeed({}),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockLLM(), config),
      mockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(verifyCalled).toBe(true);
  });

  it("should call CostService.recordCost() when cost tracking enabled", async () => {
    let costRecorded = false;

    const config = {
      ...defaultReactiveAgentsConfig("agent-001"),
      enableCostTracking: true,
    };

    const mockCost = Layer.succeed(
      Context.GenericTag<{
        routeToModel: (task: string) => Effect.Effect<any>;
        recordCost: (entry: any) => Effect.Effect<void>;
        checkCache: (query: string) => Effect.Effect<string | null>;
        cacheResponse: (query: string, response: string, model: string) => Effect.Effect<void>;
        compressPrompt: (prompt: string) => Effect.Effect<any>;
        checkBudget: (cost: number, agentId: string, sessionId: string) => Effect.Effect<void>;
        getBudgetStatus: (agentId: string) => Effect.Effect<any>;
        getReport: (period: string, agentId?: string) => Effect.Effect<any>;
      }>("CostService"),
      {
        routeToModel: () => Effect.succeed({ model: "test-model", tier: "sonnet" }),
        recordCost: () => {
          costRecorded = true;
          return Effect.void;
        },
        checkCache: () => Effect.succeed(null),
        cacheResponse: () => Effect.void,
        compressPrompt: () => Effect.succeed({ compressed: "", savedTokens: 0 }),
        checkBudget: () => Effect.void,
        getBudgetStatus: () => Effect.succeed({}),
        getReport: () => Effect.succeed({}),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockLLM(), config),
      mockCost,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(costRecorded).toBe(true);
  });
});

// ─── OpenAI Tool Calling (C2) ───

describe("C2: OpenAI Tool Calling Format", () => {
  it("should extract tool_calls from LLM response and execute them", async () => {
    let callCount = 0;
    const llmLayer = Layer.succeed(
      Context.GenericTag<{
        complete: (req: unknown) => Effect.Effect<{
          content: string;
          stopReason: string;
          toolCalls?: unknown[];
          usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            estimatedCost: number;
          };
          model: string;
        }>;
      }>("LLMService"),
      {
        complete: (_req: unknown) => {
          callCount++;
          if (callCount === 1) {
            // First call: return tool calls (simulating OpenAI format)
            return Effect.succeed({
              content: "",
              stopReason: "tool_use",
              toolCalls: [
                {
                  id: "call-abc123",
                  name: "calculator",
                  input: { expression: "2+2" },
                },
              ],
              usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
              model: "test-model",
            });
          }
          // Second call: return final answer
          return Effect.succeed({
            content: "The answer is 4.",
            stopReason: "end_turn",
            toolCalls: [],
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
            model: "test-model",
          });
        },
      },
    );

    const testLayer = makeTestLayer(llmLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
    expect(result.metadata.tokensUsed).toBe(40); // 20 + 20
  });
});
