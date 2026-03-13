/**
 * Max Iterations Enforcement Contract Tests
 *
 * Verifies that maxIterations config actually stops the agent after N iterations.
 *
 * Design note: We use the ExecutionEngine layer directly (same pattern as
 * feature-contract.test.ts) so we can inject a mock LLM that always returns
 * tool calls — this prevents `done = true` from short-circuiting the loop.
 *
 * The direct LLM path sets `done = (stopReason === "end_turn" && !toolCalls)`.
 * If `toolCalls` is non-empty, `done = false` and the agent loops until it hits
 * maxIterations.
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Mock LLM that always returns a tool call (never completes) ───────────────

/**
 * A mock LLM that always returns tool call requests and never produces a
 * completion signal. This forces the agent to rely on maxIterations to stop.
 */
function makeInfiniteLoopLLM() {
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
        return Effect.succeed({
          content: "I need to search for more information.",
          // Always return a tool call — this sets done=false and forces looping
          stopReason: "tool_use",
          toolCalls: [
            { id: `call-${callCount}`, name: "web_search", input: { query: "still searching" } },
          ],
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            estimatedCost: 0.001,
          },
          model: "test-model",
        });
      },
    },
  );
}

// ─── Mock ToolService ──────────────────────────────────────────────────────────

const MockToolServiceLayer = Layer.succeed(
  Context.GenericTag<{
    listTools: () => Effect.Effect<readonly { name: string; description: string }[]>;
    execute: (params: { toolName: string; arguments: unknown; agentId: string; sessionId: string }) => Effect.Effect<{ result: unknown }>;
    toFunctionCallingFormat: () => Effect.Effect<readonly unknown[]>;
  }>("ToolService"),
  {
    listTools: () => Effect.succeed([
      { name: "web_search", description: "Search the web" },
    ]),
    execute: (params) => Effect.succeed({
      result: `Mock result from ${params.toolName}`,
    }),
    toFunctionCallingFormat: () => Effect.succeed([
      { name: "web_search", description: "Search the web", input_schema: { type: "object", properties: {} } },
    ]),
  },
);

// ─── Test Harness ─────────────────────────────────────────────────────────────

function makeEngine(maxIterations: number) {
  const config = defaultReactiveAgentsConfig("test-agent", { maxIterations });
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  return { config, engineLayer };
}

function mockTask(input = "find everything about this topic") {
  return {
    id: `task-${Date.now()}` as any,
    agentId: "test-agent" as any,
    type: "query" as const,
    input: { question: input },
    priority: "medium" as const,
    status: "pending" as const,
    metadata: { tags: [] },
    createdAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("withMaxIterations enforcement", () => {
  it("agent fails with MaxIterationsError at maxIterations=1", async () => {
    const { engineLayer } = makeEngine(1);
    const llmLayer = makeInfiniteLoopLLM();
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    let threw = false;
    let errorMessage = "";

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ExecutionEngine).execute(mockTask());
        }).pipe(Effect.provide(testLayer)),
      );
    } catch (e) {
      threw = true;
      errorMessage = (e as Error).message;
    }

    expect(threw).toBe(true);
    expect(errorMessage).toMatch(/iteration|exceeded|max/i);
  });

  it("agent fails with MaxIterationsError at maxIterations=3 (not 1, not unlimited)", async () => {
    const { engineLayer } = makeEngine(3);
    const llmLayer = makeInfiniteLoopLLM();
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    let threw = false;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ExecutionEngine).execute(mockTask());
        }).pipe(Effect.provide(testLayer)),
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
  });

  it("error tag is MaxIterationsError", async () => {
    const { engineLayer } = makeEngine(2);
    const llmLayer = makeInfiniteLoopLLM();
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    let errorTag = "";

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ExecutionEngine).execute(mockTask());
        }).pipe(Effect.provide(testLayer)),
      );
    } catch (e) {
      // The error is wrapped in FiberFailure — dig into it
      const err = e as any;
      const cause = err?.[Symbol.for("effect/Runtime/FiberFailure/Cause")];
      const inner = cause?.error ?? cause?.defect ?? err;
      errorTag = inner?._tag ?? "";
    }

    expect(errorTag).toBe("MaxIterationsError");
  });

  it("MaxIterationsError carries the configured maxIterations value", async () => {
    const MAX = 2;
    const { engineLayer } = makeEngine(MAX);
    const llmLayer = makeInfiniteLoopLLM();
    const testLayer = Layer.mergeAll(engineLayer, llmLayer, MockToolServiceLayer);

    let capturedMaxIterations: number | null = null;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ExecutionEngine).execute(mockTask());
        }).pipe(Effect.provide(testLayer)),
      );
    } catch (e) {
      const err = e as any;
      const cause = err?.[Symbol.for("effect/Runtime/FiberFailure/Cause")];
      const inner = cause?.error ?? cause?.defect ?? err;
      if (inner?._tag === "MaxIterationsError") {
        capturedMaxIterations = inner.maxIterations;
      }
    }

    expect(capturedMaxIterations).toBe(MAX);
  });

  it("normal completion does not throw when LLM produces end_turn with no tools", async () => {
    // Sanity check: the OPPOSITE condition — LLM ends cleanly, should NOT throw
    const completingLLM = Layer.succeed(
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
        complete: (_req: unknown) =>
          Effect.succeed({
            content: "FINAL ANSWER: Task is done.",
            stopReason: "end_turn",
            toolCalls: [],
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70, estimatedCost: 0 },
            model: "test-model",
          }),
      },
    );

    const { engineLayer } = makeEngine(5);
    const testLayer = Layer.mergeAll(engineLayer, completingLLM);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExecutionEngine).execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
  });
});
