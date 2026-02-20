import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// Minimal mock LLM service
const MockLLMServiceLive = Layer.succeed(
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
        content: "Task completed: Here is the answer.",
        stopReason: "end_turn",
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCost: 0,
        },
        model: "test-model",
      }),
  },
);

// Minimal mock task
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

describe("ExecutionEngine", () => {
  const config = defaultReactiveAgentsConfig("agent-001");

  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
  );

  const testLayer = Layer.mergeAll(hookLayer, engineLayer, MockLLMServiceLive);

  it("should execute a task through all phases", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-001");
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });

  it("should track running context during execution", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;

        yield* engine.registerHook({
          phase: "think",
          timing: "before",
          handler: (ctx) =>
            Effect.gen(function* () {
              const running = yield* engine.getContext(ctx.taskId);
              expect(running).not.toBeNull();
              return ctx;
            }),
        });

        yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("should fail with MaxIterationsError when loop exceeds limit", async () => {
    const LoopingLLM = Layer.succeed(
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
            content: "Calling tool...",
            stopReason: "tool_use",
            toolCalls: [{ id: "call-1", name: "search", input: {} }],
            usage: {
              inputTokens: 5,
              outputTokens: 5,
              totalTokens: 10,
              estimatedCost: 0,
            },
            model: "test-model",
          }),
      },
    );

    const limitedConfig = { ...config, maxIterations: 2 };
    const limitedHookLayer = LifecycleHookRegistryLive;
    const limitedEngineLayer = ExecutionEngineLive(limitedConfig).pipe(
      Layer.provide(limitedHookLayer),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(limitedHookLayer, limitedEngineLayer, LoopingLLM),
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("MaxIterationsError");
    }
  });

  it("should fire lifecycle hooks in correct order", async () => {
    const hookLog: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;

        yield* engine.registerHook({
          phase: "bootstrap",
          timing: "before",
          handler: (ctx) => {
            hookLog.push("bootstrap:before");
            return Effect.succeed(ctx);
          },
        });

        yield* engine.registerHook({
          phase: "bootstrap",
          timing: "after",
          handler: (ctx) => {
            hookLog.push("bootstrap:after");
            return Effect.succeed(ctx);
          },
        });

        yield* engine.registerHook({
          phase: "complete",
          timing: "after",
          handler: (ctx) => {
            hookLog.push("complete:after");
            return Effect.succeed(ctx);
          },
        });

        yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(hookLog).toContain("bootstrap:before");
    expect(hookLog).toContain("bootstrap:after");
    expect(hookLog).toContain("complete:after");
    expect(hookLog.indexOf("bootstrap:before")).toBeLessThan(
      hookLog.indexOf("bootstrap:after"),
    );
  });
});
