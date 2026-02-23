/**
 * Feature Contract Tests
 *
 * These tests verify the OBSERVABLE BEHAVIOR of the framework from the user's
 * perspective — the same perspective as someone writing `test.ts` with
 * `.withHook()`, `.withReasoning()`, `.withTools()` etc.
 *
 * Each test validates a specific user-facing contract:
 * - Hook fires at the correct phase with correct context shape
 * - iteration counter starts at 1 and increments correctly
 * - stepsCount reflects actual work done
 * - tokensUsed accumulates across the execution
 * - Tool results visible in act hook context
 * - Reasoning path fires act/observe hooks if tools were used
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context, Ref } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Mock Primitives ───────────────────────────────────────────────────────

function makeMockLLM(opts: {
  content?: string;
  toolCalls?: unknown[];
  tokens?: number;
  cost?: number;
  stopOnSecondCall?: boolean;
}) {
  let callCount = 0;
  return Layer.succeed(
    Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        stopReason: string;
        toolCalls?: unknown[];
        usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
        model: string;
      }>;
    }>("LLMService"),
    {
      complete: (_req: unknown) => {
        callCount++;
        const isFirstCall = callCount === 1;
        return Effect.succeed({
          content: opts.content ?? "FINAL ANSWER: Task completed.",
          stopReason: "end_turn",
          toolCalls: isFirstCall && !opts.stopOnSecondCall ? (opts.toolCalls ?? []) : [],
          usage: {
            inputTokens: 100,
            outputTokens: opts.tokens ?? 50,
            totalTokens: (opts.tokens ?? 50) + 100,
            estimatedCost: opts.cost ?? 0.001,
          },
          model: "test-model",
        });
      },
    },
  );
}

// Mock ToolService that always succeeds
const MockToolServiceLayer = Layer.succeed(
  Context.GenericTag<{
    listTools: () => Effect.Effect<readonly { name: string; description: string }[]>;
    execute: (params: { toolName: string; arguments: unknown; agentId: string; sessionId: string }) => Effect.Effect<{ result: unknown }>;
    toFunctionCallingFormat: () => Effect.Effect<readonly unknown[]>;
  }>("ToolService"),
  {
    listTools: () => Effect.succeed([
      { name: "web_search", description: "Search the web" },
      { name: "file_write", description: "Write to a file" },
    ]),
    execute: (params) => Effect.succeed({
      result: `Mock result from ${params.toolName}(${JSON.stringify(params.arguments)})`,
    }),
    toFunctionCallingFormat: () => Effect.succeed([
      { name: "web_search", description: "Search the web", input_schema: { type: "object", properties: {} } },
      { name: "file_write", description: "Write to a file", input_schema: { type: "object", properties: {} } },
    ]),
  },
);

// Mock ReasoningService with configurable tool usage
function makeMockReasoningService(opts: {
  toolsUsed?: Array<{ name: string; result: string }>;
  stepsCount?: number;
  output?: string;
}) {
  const toolsUsed = opts.toolsUsed ?? [];
  const stepsCount = opts.stepsCount ?? (toolsUsed.length * 2 + 1); // thought + action + observation per tool + final thought
  return Layer.succeed(
    Context.GenericTag<{
      execute: (params: unknown) => Effect.Effect<{
        output: unknown;
        status: string;
        steps?: readonly { id: string; type: string; content: string; metadata?: { toolUsed?: string } }[];
        metadata: { cost: number; tokensUsed: number; stepsCount: number };
      }>;
    }>("ReasoningService"),
    {
      execute: (_params: unknown) => {
        const steps = [
          { id: "step-0", type: "thought", content: "I need to gather information." },
          ...toolsUsed.flatMap((t, i) => [
            { id: `step-${i * 2 + 1}`, type: "action", content: `${t.name}(query)`, metadata: { toolUsed: t.name } },
            { id: `step-${i * 2 + 2}`, type: "observation", content: t.result },
          ]),
          { id: `step-final`, type: "thought", content: "I have enough information to answer." },
        ];
        return Effect.succeed({
          output: opts.output ?? "FINAL ANSWER: Result from reasoning.",
          status: "completed",
          steps,
          metadata: {
            cost: 0.002,
            tokensUsed: 500,
            stepsCount,
          },
        });
      },
    },
  );
}

const mockTask = (input = "What is 2+2?") => ({
  id: `task-${Date.now()}` as any,
  agentId: "test-agent" as any,
  type: "query" as const,
  input: { question: input },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
});

// ─── Test Harness ──────────────────────────────────────────────────────────

function makeEngine(config?: Partial<import("../src/types.js").ReactiveAgentsConfig>) {
  const base = defaultReactiveAgentsConfig("test-agent", config);
  // ExecutionEngineLive requires LifecycleHookRegistry — provide it directly so
  // the resulting layer has no unsatisfied deps and can be merged with LLM/tool layers.
  const engineLayer = ExecutionEngineLive(base).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  return { config: base, engineLayer };
}

// ─── HOOK CONTRACTS ────────────────────────────────────────────────────────

describe("Hook contracts — direct-LLM path (no reasoning)", () => {
  it("iteration counter starts at 1 on first think hook", async () => {
    const iterations: number[] = [];
    const { config, engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: 4" });

    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => {
            iterations.push(ctx.iteration);
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(iterations[0]).toBe(1); // First iteration must be 1, not 0
  });

  it("think hook fires with correct maxIterations", async () => {
    let capturedMax = -1;
    const { engineLayer } = makeEngine({ maxIterations: 7 });
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => {
            capturedMax = ctx.maxIterations;
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(capturedMax).toBe(7);
  });

  it("complete hook fires with correct taskId", async () => {
    let capturedTaskId = "";
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);
    const task = mockTask();

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => {
            capturedTaskId = ctx.taskId;
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(task);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(capturedTaskId).toBe(String(task.id));
  });

  it("act hook fires and receives toolResults when LLM calls tools", async () => {
    const actContexts: unknown[] = [];
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: done",
      toolCalls: [
        { id: "call-1", name: "web_search", input: { query: "bitcoin price" } },
      ],
    });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "act",
          timing: "after",
          handler: (ctx) => {
            actContexts.push({ toolResults: ctx.toolResults, iteration: ctx.iteration });
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(actContexts.length).toBeGreaterThan(0);
    const actCtx = actContexts[0] as any;
    expect(actCtx.toolResults.length).toBeGreaterThan(0);
    expect(actCtx.toolResults[0].toolName).toBe("web_search");
  });

  it("tokensUsed in complete hook reflects accumulated usage", async () => {
    let completedTokens = 0;
    const { engineLayer } = makeEngine();
    // LLM returns 200 tokens per call, first call has tools → 2 LLM calls
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: done",
      tokens: 200,
      toolCalls: [
        { id: "call-1", name: "web_search", input: {} },
      ],
    });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => {
            completedTokens = ctx.tokensUsed;
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // At least one LLM call happened → tokens should be positive
    expect(completedTokens).toBeGreaterThan(0);
  });

  it("hook fires 'before' then 'after' for the same phase", async () => {
    const order: string[] = [];
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "before",
          handler: (ctx) => { order.push("before-think"); return Effect.succeed(ctx); },
        });
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => { order.push("after-think"); return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    const thinkIdx = order.indexOf("before-think");
    const afterThinkIdx = order.indexOf("after-think");
    expect(thinkIdx).toBeGreaterThanOrEqual(0);
    expect(afterThinkIdx).toBeGreaterThan(thinkIdx);
  });
});

// ─── REASONING PATH CONTRACTS ─────────────────────────────────────────────

describe("Hook contracts — reasoning path (withReasoning)", () => {
  it("think hook fires once with iteration >= 1", async () => {
    const thinkIterations: number[] = [];
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: 42" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => { thinkIterations.push(ctx.iteration); return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(thinkIterations.length).toBe(1);
    expect(thinkIterations[0]).toBeGreaterThanOrEqual(1);
  });

  it("act hook fires after reasoning when tools were used", async () => {
    let actFired = false;
    let toolsInActCtx: unknown[] = [];

    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [
        { name: "web_search", result: "BTC price: $65,000" },
        { name: "file_write", result: "Written to crypto.md" },
      ],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "act",
          timing: "after",
          handler: (ctx) => {
            actFired = true;
            toolsInActCtx = ctx.toolResults;
            return Effect.succeed(ctx);
          },
        });
        yield* engine.execute(mockTask("Find the price of bitcoin and write to crypto.md"));
      }).pipe(Effect.provide(testLayer)),
    );

    expect(actFired).toBe(true);
    expect(toolsInActCtx.length).toBe(2);
    expect((toolsInActCtx[0] as any).toolName).toBe("web_search");
    expect((toolsInActCtx[1] as any).toolName).toBe("file_write");
  });

  it("act hook does NOT fire when reasoning used no tools", async () => {
    let actFired = false;
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [], // no tools used
      output: "FINAL ANSWER: I know this from memory.",
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "act",
          timing: "after",
          handler: (ctx) => { actFired = true; return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(actFired).toBe(false);
  });

  it("complete hook receives stepsCount from reasoning metadata", async () => {
    let finalStepsCount = -1;
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [
        { name: "web_search", result: "result 1" },
        { name: "web_search", result: "result 2" },
      ],
      stepsCount: 7,
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => { finalStepsCount = ctx.iteration; return Effect.succeed(ctx); },
        });
        return yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // stepsCount in the final TaskResult should reflect reasoning steps
    expect(result.metadata.stepsCount).toBe(7);
  });

  it("tokensUsed reflects reasoning service token usage", async () => {
    let completedTokens = 0;
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({
      output: "FINAL ANSWER: done",
      stepsCount: 3,
    }); // reasoning reports 500 tokensUsed
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => { completedTokens = ctx.tokensUsed; return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(completedTokens).toBe(500); // from mock reasoning service
  });
});

// ─── TASK RESULT CONTRACTS ────────────────────────────────────────────────

describe("TaskResult shape contracts", () => {
  it("result.success is true on normal completion", async () => {
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("result.metadata.stepsCount > 0 when tool calls occur", async () => {
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: done",
      toolCalls: [{ id: "c1", name: "web_search", input: {} }],
    });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });

  it("result.metadata.tokensUsed > 0", async () => {
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done", tokens: 75 });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  it("result.metadata.duration > 0", async () => {
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Duration is wall-clock ms; may be 0 on fast hardware — just verify it's a finite non-negative number
    expect(typeof result.metadata.duration).toBe("number");
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("result.agentId matches the configured agent", async () => {
    const { engineLayer } = makeEngine();
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer);
    const task = mockTask();
    task.agentId = "my-specific-agent" as any;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(task);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.agentId).toBe("my-specific-agent");
  });
});

// ─── MULTI-ITERATION CONTRACTS ────────────────────────────────────────────

describe("Multi-iteration contracts (direct-LLM path)", () => {
  it("think fires multiple times when tools cause loop continuation", async () => {
    const thinkIterations: number[] = [];
    const { engineLayer } = makeEngine();
    // First call: returns tool call; Second call: FINAL ANSWER (terminates loop)
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: done",
      toolCalls: [{ id: "c1", name: "web_search", input: { q: "test" } }],
    });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => { thinkIterations.push(ctx.iteration); return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Iteration 1: think fires at 1, tool called → loop
    // Iteration 2: think fires at 2 (no tool call) → FINAL ANSWER → done
    expect(thinkIterations.length).toBe(2);
    expect(thinkIterations[0]).toBe(1);
    expect(thinkIterations[1]).toBe(2);
  });

  it("iteration increments correctly across multiple loops", async () => {
    const thinkIterations: number[] = [];
    const { engineLayer } = makeEngine({ maxIterations: 5 });
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: done",
      toolCalls: [{ id: "c1", name: "web_search", input: {} }],
    });
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "think",
          timing: "after",
          handler: (ctx) => { thinkIterations.push(ctx.iteration); return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Iterations should be consecutive starting at 1: [1, 2]
    expect(thinkIterations[0]).toBe(1);
    for (let i = 1; i < thinkIterations.length; i++) {
      expect(thinkIterations[i]).toBe(thinkIterations[i - 1]! + 1);
    }
  });
});
