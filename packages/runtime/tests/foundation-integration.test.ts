// Tests for Sprint 1 & 2 foundation integration (C1-C5, H1-H3, H5)
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Stub ReasoningService (Move 1 dead-arm removal, 2026-08-21) ───────────
//
// `ExecutionEngineLive` now always routes through the kernel arm when a
// `ReasoningService` is available; the raw `LLMService` mocks this file used
// to drive the (now-deleted) inline arm directly are no longer on the
// execution path. These tests exercise generic engine-level wiring
// (token/metadata pass-through, observability spans, guardrail/verification/
// cost-service hook firing) that doesn't depend on which reasoning
// implementation runs underneath, so a minimal `ReasoningService` stub —
// matching the pattern in `chat-history-seeds-kernel.test.ts` — preserves
// each assertion's meaning. Two tests (C4, C2) asserted on raw
// `LLMService.complete()` request/response shape, which is inline-arm-only
// plumbing; those are redesigned below to assert the equivalent real
// boundary on the kernel arm (the params `ReasoningService.execute()`
// receives, and the metadata it reports), not a hollowed-out pass.
type StubReasoningResult = {
  output: unknown;
  status: "completed" | "failed" | "partial";
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number };
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<StubReasoningResult>;
}>("ReasoningService");

const makeMockReasoning = (opts?: {
  content?: string;
  tokenCount?: number;
  stepsCount?: number;
}) => {
  const tokenCount = opts?.tokenCount ?? 30;
  return Layer.succeed(ReasoningServiceTag, {
    execute: (_params: { [k: string]: unknown }) =>
      Effect.succeed({
        output: opts?.content ?? "Task completed.",
        status: "completed" as const,
        steps: [{ id: "step-1", type: "thought", content: opts?.content ?? "Task completed." }],
        metadata: { cost: tokenCount * 0.00001, tokensUsed: tokenCount, stepsCount: opts?.stepsCount ?? 1 },
      }),
  });
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

const makeTestLayer = (reasoningLayer: Layer.Layer<any, any>, config = defaultReactiveAgentsConfig("agent-001")) => {
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
  );
  return Layer.mergeAll(hookLayer, engineLayer, reasoningLayer);
};

// ─── C5: Token Tracking ───

describe("C5: Token Tracking", () => {
  it("should accumulate tokensUsed from LLM responses", async () => {
    const testLayer = makeTestLayer(makeMockReasoning({ tokenCount: 42 }));

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
    // Reports the SAME total a 2-iteration inline run would have produced
    // (20 + 30 = 50) — the kernel arm sums tokens across its own internal
    // iterations and reports the total via ReasoningResult.metadata, so
    // this asserts the engine passes that total through unchanged rather
    // than re-deriving multi-iteration LLM call mechanics that are now
    // internal to the kernel.
    const testLayer = makeTestLayer(makeMockReasoning({ tokenCount: 50, stepsCount: 2 }));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.metadata.tokensUsed).toBe(50);
    expect(result.metadata.stepsCount).toBe(2);
  });
});

// ─── C4: Tool Definition Type Adapter ───

describe("C4: Tool Definition Type Adapter", () => {
  it("should pass tools from ToolService to the reasoning layer", async () => {
    // REDESIGN NOTE (Move 1 dead-arm removal, 2026-08-21): this test used to
    // intercept the raw `LLMService.complete()` request's `tools` field —
    // inline-arm-only plumbing (the kernel arm never calls `complete()`
    // directly with a bare `tools` array; it threads schemas through
    // `ReasoningService.execute({ availableToolSchemas })`
    // instead, per `packages/runtime/src/execution-engine.ts`'s kernel
    // branch). Asserting on THAT boundary instead proves the same real
    // fact — tools registered on `ToolService` reach whatever executes the
    // task — at the boundary that is actually live in production now.
    let receivedToolNames: readonly string[] | undefined;
    const capturingReasoningLayer = Layer.succeed(ReasoningServiceTag, {
      execute: (params: { [k: string]: unknown }) => {
        const schemas = params.availableToolSchemas as readonly { name: string }[] | undefined;
        receivedToolNames = schemas?.map((s) => s.name);
        return Effect.succeed({
          output: "Done",
          status: "completed" as const,
          steps: [{ id: "step-1", type: "thought", content: "Done" }],
          metadata: { cost: 0, tokensUsed: 10, stepsCount: 1 },
        });
      },
    });

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
          Effect.succeed([{ name: "search", description: "Search the web", parameters: [] }]),
        execute: () => Effect.succeed({ toolName: "search", success: true, result: "result", executionTimeMs: 0 }),
        register: () => Effect.void,
        connectMCPServer: () => Effect.succeed({} as any),
        disconnectMCPServer: () => Effect.void,
        getTool: () => Effect.succeed({} as any),
        listMCPServers: () => Effect.succeed([]),
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(capturingReasoningLayer),
      mockToolService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // Verify tools were passed to the reasoning layer
    expect(receivedToolNames).toBeDefined();
    expect(receivedToolNames).toContain("search");
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
        verbosity: () => string;
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
        verbosity: () => "normal",
      },
    );

    const testLayer = Layer.mergeAll(
      makeTestLayer(makeMockReasoning()),
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
      makeTestLayer(makeMockReasoning(), config),
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
      makeTestLayer(makeMockReasoning(), config),
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
      makeTestLayer(makeMockReasoning(), config),
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
      makeTestLayer(makeMockReasoning(), config),
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
  it("should reflect tool-call-bearing multi-step reasoning results in the TaskResult", async () => {
    // REDESIGN NOTE (Move 1 dead-arm removal, 2026-08-21): this test used to
    // drive the inline arm's raw `LLMService.complete()` mock through two
    // calls (a tool_use turn, then an end_turn) and assert on `callCount`
    // and the summed `usage.totalTokens` across both — inline-arm-only
    // mechanics; the kernel arm makes and sums its own LLM calls
    // internally and reports only the aggregate via `ReasoningResult`. The
    // real end-to-end proof that OpenAI-style tool_calls are extracted and
    // executed by the live kernel arm is
    // `execution-engine.test.ts`'s "should record tool execution metrics
    // when tools are called" test (drives a real scripted tool call through
    // the builder + real kernel). This test instead proves the ENGINE-level
    // contract still under test here: a multi-step ReasoningResult (as a
    // tool-call turn followed by a final-answer turn would produce) is
    // faithfully reflected in the assembled TaskResult.
    const testLayer = makeTestLayer(
      makeMockReasoning({ content: "The answer is 4.", tokenCount: 40, stepsCount: 2 }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.metadata.stepsCount).toBe(2);
    expect(result.metadata.tokensUsed).toBe(40); // 20 + 20, the two-turn total
  });
});
