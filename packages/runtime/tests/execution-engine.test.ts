import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ── Stub ReasoningService (Move 1 dead-arm removal, 2026-08-21) ────────────
//
// `ExecutionEngineLive` now always routes through the kernel arm when a
// `ReasoningService` is available (`reasoningOpt._tag === "Some"`); the old
// `else if` inline arm this file drove directly via a raw mocked `LLMService`
// is dead in production and has been deleted. These tests exercise generic
// engine-level behavior (result assembly, lifecycle hooks, running-context
// tracking, tool-metrics events) that doesn't depend on which reasoning
// implementation runs underneath — so a minimal `ReasoningService` stub,
// matching the pattern in `chat-history-seeds-kernel.test.ts`, is enough to
// route them through the real (now sole) production arm.
type StubReasoningResult = {
  output: unknown;
  status: "completed" | "failed" | "partial";
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number };
  error?: string;
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<StubReasoningResult>;
}>("ReasoningService");

function stubReasoningLayer(impl: (params: { [k: string]: unknown }) => StubReasoningResult) {
  return Layer.succeed(ReasoningServiceTag, {
    execute: (params: { [k: string]: unknown }) => Effect.succeed(impl(params)),
  });
}

const completingReasoningLayer = stubReasoningLayer(() => ({
  output: "Task completed: Here is the answer.",
  status: "completed",
  steps: [{ id: "step-1", type: "thought", content: "Task completed: Here is the answer." }],
  metadata: { cost: 0, tokensUsed: 30, stepsCount: 1 },
}));

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

  const testLayer = Layer.mergeAll(hookLayer, engineLayer, completingReasoningLayer);

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

  it("fails gracefully (success:false, terminatedBy:max_iterations) when the kernel exhausts maxIterations", async () => {
    // REDESIGN NOTE (Move 1 dead-arm removal, 2026-08-21): this test used to
    // drive the inline arm's while-loop directly (a raw `LLMService` mock
    // that always returned `tool_use`, forcing `maxIterations` exhaustion)
    // and assert an Effect FAILURE tagged `MaxIterationsError` — an
    // inline-arm-only exception type that does not exist on the kernel arm.
    // The kernel arm's real contract (confirmed against
    // `max-iterations-enforcement.test.ts` and
    // `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts`) is
    // that a genuine cap exhaustion is a graceful `TaskResult.success:false`
    // — the returned Effect SUCCEEDS with a failed-looking result, it does
    // not fail as an Effect. This stub simulates exactly that terminal
    // shape to prove the engine assembles a failed TaskResult correctly
    // rather than crashing or silently reporting success.
    const maxIterationsLayer = stubReasoningLayer(() => ({
      output: null,
      status: "failed",
      steps: [{ id: "step-1", type: "thought", content: "still searching" }],
      metadata: { cost: 0, tokensUsed: 10, stepsCount: 1 },
      error: "Maximum iterations (2) exceeded",
    }));

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
          Layer.mergeAll(limitedHookLayer, limitedEngineLayer, maxIterationsLayer),
        ),
      ),
    );

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.success).toBe(false);
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

  it("should record tool execution metrics when tools are called", async () => {
    // REDESIGN NOTE (Move 1 dead-arm removal, 2026-08-21): `ToolCallCompleted`
    // is published by the KERNEL's own tool-observation hook
    // (`packages/reasoning/src/kernel/state/kernel-hooks.ts` `onObservation`
    // for the default reactive strategy), not by `ToolService.execute()`
    // itself (confirmed by reading `tool-service.ts` — it only publishes an
    // internal `"tools.executed"` custom event) and not reproducible from a
    // `ReasoningService` stub. Producing it for real requires the actual
    // kernel arm to run a genuine tool call end-to-end, which is exactly
    // what `.withTestScenario()` + `.withTools()` wires via the builder
    // (`ReactiveAgents.create()`) — switching to the builder here, rather
    // than hand-assembling the full production layer stack
    // (`createReasoningLayer()` + `TestLLMService` + real `ToolService`)
    // directly against `ExecutionEngineLive`, gets the identical real
    // tool-call path with far less wiring risk. The public, durable proof
    // that the engine recorded the tool call is `result.receipt.toolsUsed`
    // (Arc 1 Task 8's deterministic trust receipt) — the same field
    // `tool-loop-behavioral.test.ts` asserts on for its own real tool-call
    // proof.
    const { ReactiveAgents } = await import("../src/builder.js");

    const agent = await ReactiveAgents.create()
      .withName("tool-metrics-test")
      .withTestScenario([
        { toolCall: { name: "test-file-tool", args: { path: "/tmp/test.txt" } } },
        { text: "Based on the file contents, the answer is 42." },
      ])
      .withTools({
        tools: [
          {
            definition: {
              name: "test-file-tool",
              description: "Read a file",
              parameters: [
                { name: "path", type: "string" as const, description: "File path", required: true },
              ],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: () => Effect.succeed("file contents here"),
          },
        ],
      })
      .build();

    let result;
    try {
      result = await agent.run("read the file and tell me the answer");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.receipt?.toolsUsed).toEqual(["test-file-tool"]);
  });
});
