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
//
// The raw `LLMService` mock this file used to also carry (`makeMockLLM`) drove
// the dead inline direct-LLM arm (deleted alongside `execution-engine.ts`'s
// `else if (!cacheHit)` branch, Move 1, 2026-08-13) — every test below now
// routes through the kernel arm via `makeMockReasoningService`.

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

// Migrated off the dead inline arm (Move 1, 2026-08-13). These tests used to
// drive `ExecutionEngineLive` with ONLY a raw `LLMService` mock, which
// exercised the direct-LLM branch (`reasoningOpt` resolves to `None`). Now
// routed through the kernel arm via `makeMockReasoningService`, same as the
// "reasoning path" describe block below — the hook contracts themselves
// (iteration numbering, taskId, tool results, accumulated tokens, before/after
// ordering) are arm-agnostic, so the assertions carry over unchanged.
describe("Hook contracts — kernel arm (single ReasoningService pass)", () => {
  it("iteration counter starts at 1 on first think hook", async () => {
    const iterations: number[] = [];
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: 4" });

    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

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
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

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
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);
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

  it("act hook fires and receives toolResults when the reasoning pass calls tools", async () => {
    const actContexts: unknown[] = [];
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [{ name: "web_search", result: "bitcoin price: $65,000" }],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

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
    // makeMockReasoningService reports tokensUsed: 500 in its metadata.
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [{ name: "web_search", result: "result" }],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

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

    // The reasoning pass reported real usage → tokens should be positive
    expect(completedTokens).toBeGreaterThan(0);
  });

  it("hook fires 'before' then 'after' for the same phase", async () => {
    const order: string[] = [];
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

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
    let toolsInActCtx: readonly unknown[] = [];

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
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

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
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [{ name: "web_search", result: "result" }],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });

  it("result.metadata.tokensUsed > 0", async () => {
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  // GH #126 — totalTokens is an additive alias mirroring tokensUsed.
  // Pins the contract so a future commit removing one without updating the
  // other (or letting them drift) fails this test rather than silently
  // breaking downstream consumers that read either name.
  it("result.metadata.totalTokens mirrors tokensUsed (GH #126 alias)", async () => {
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    const md = result.metadata as {
      tokensUsed: number;
      totalTokens?: number;
    };
    expect(md.totalTokens).toBeDefined();
    expect(md.totalTokens).toBe(md.tokensUsed);
  });

  it("result.metadata.duration > 0", async () => {
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Duration is wall-clock ms; may be 0 on fast hardware — just verify it's a finite non-negative number
    expect(typeof result.metadata.duration).toBe("number");
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("result.metadata.confidence reflects reasoning strategy confidence", async () => {
    const { engineLayer } = makeEngine();
    // Custom reasoning mock that includes confidence in metadata
    const reasoningLayer = Layer.succeed(
      Context.GenericTag<{
        execute: (params: unknown) => Effect.Effect<{
          output: unknown;
          status: string;
          steps?: readonly { id: string; type: string; content: string }[];
          metadata: { cost: number; tokensUsed: number; stepsCount: number; confidence: number };
        }>;
      }>("ReasoningService"),
      {
        execute: (_params: unknown) =>
          Effect.succeed({
            output: "Completed answer",
            status: "completed",
            steps: [{ id: "s1", type: "thought", content: "thinking" }],
            metadata: { cost: 0.001, tokensUsed: 200, stepsCount: 1, confidence: 0.8 },
          }),
      },
    );
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // confidence is now a string categorical ("high" | "medium" | "low"); 0.8 maps to "high"
    expect(result.metadata.confidence).toBe("high");
  });

  it("result.agentId matches the configured agent", async () => {
    const { engineLayer } = makeEngine();
    const reasoningLayer = makeMockReasoningService({ output: "FINAL ANSWER: done" });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer);
    const task = mockTask();
    task.agentId = "my-specific-agent" as any;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(task);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(String(result.agentId)).toBe("my-specific-agent");
  });
});

// ─── MULTI-ITERATION CONTRACTS ────────────────────────────────────────────
//
// Migrated off the dead inline arm (Move 1, 2026-08-13). The inline direct-LLM
// while-loop drove the outer engine's `think` hook once per LLM round-trip, so
// a multi-tool-call task fired `think` N times with `ctx.iteration` counting
// 1, 2, 3... That per-round-trip loop lived entirely in `inline-think.ts` /
// `execution-engine.ts`'s deleted `else if (!cacheHit)` branch — the kernel
// arm's tool-use loop runs INSIDE `ReasoningService.execute()`, invisible to
// the outer engine, so the outer `think` hook now fires exactly ONCE per task
// regardless of how many tool rounds the reasoning pass took internally (see
// "think hook fires once with iteration >= 1" in the reasoning-path describe
// block above). There is no kernel-arm mechanism that makes the OUTER think
// hook fire multiple times — that specific mechanism doesn't exist on the
// sole remaining arm, by construction.
//
// The tests' actual intent — "the iteration count reflects the amount of
// real multi-step work the agent did, not a hardcoded 1" — DOES have a
// kernel-arm equivalent: `reasoning-post-think.ts` sets
// `ctx.iteration = ctx.metadata.stepsCount` after the pass completes, so a
// multi-tool-call run's iteration count in the `complete` hook reflects the
// reasoning service's real step count. Redesigned below to pin that contract
// instead of the now-impossible per-round-trip think-hook-firing one.
describe("Multi-iteration contracts (kernel arm)", () => {
  it("think hook fires exactly once per task regardless of internal tool-use rounds", async () => {
    const thinkIterations: number[] = [];
    const { engineLayer } = makeEngine();
    // Reasoning pass internally used 2 tools (multiple "rounds" from the
    // reasoning service's perspective) — the outer think hook still fires once.
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [
        { name: "web_search", result: "result 1" },
        { name: "web_search", result: "result 2" },
      ],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

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
    expect(thinkIterations[0]).toBe(1);
  });

  it("final iteration count reflects the reasoning pass's real step count, not a hardcoded 1", async () => {
    let finalIteration = -1;
    const { engineLayer } = makeEngine({ maxIterations: 5 });
    // toolsUsed: 2 tools → stepsCount = 2*2+1 = 5 (thought + action/observation
    // per tool + final thought), per makeMockReasoningService's default.
    const reasoningLayer = makeMockReasoningService({
      toolsUsed: [
        { name: "web_search", result: "result 1" },
        { name: "web_search", result: "result 2" },
      ],
    });
    const testLayer = Layer.mergeAll(engineLayer, reasoningLayer, MockToolServiceLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => { finalIteration = ctx.iteration; return Effect.succeed(ctx); },
        });
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Gutting the stepsCount → iteration wiring (reasoning-post-think.ts)
    // would leave this at 1 → RED.
    expect(finalIteration).toBe(5);
  });
});
