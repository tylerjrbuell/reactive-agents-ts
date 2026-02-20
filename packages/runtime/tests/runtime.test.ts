import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { createRuntime } from "../src/runtime.js";
import { ExecutionEngine } from "../src/execution-engine.js";

describe("createRuntime", () => {
  it("should create a valid runtime layer with test provider", async () => {
    const runtime = createRuntime({
      agentId: "test-agent",
      provider: "test",
    });

    // Verify the layer provides ExecutionEngine
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return engine;
      }).pipe(Effect.provide(runtime)),
    );

    expect(result).toBeDefined();
    expect(typeof result.execute).toBe("function");
    expect(typeof result.registerHook).toBe("function");
    expect(typeof result.getContext).toBe("function");
    expect(typeof result.cancel).toBe("function");
  });

  it("should accept configuration options", () => {
    const runtime = createRuntime({
      agentId: "test-agent",
      provider: "test",
      memoryTier: "1",
      maxIterations: 5,
      enableGuardrails: false,
      enableVerification: false,
      enableCostTracking: false,
      enableAudit: false,
    });

    expect(runtime).toBeDefined();
  });

  it("should execute a task through the runtime", async () => {
    const runtime = createRuntime({
      agentId: "test-agent",
      provider: "test",
      testResponses: {
        "hello": "Hello! How can I help you?",
      },
    });

    const mockTask = {
      id: "task-rt-001" as any,
      agentId: "test-agent" as any,
      type: "query" as const,
      input: { question: "hello" },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(runtime)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-rt-001");
  });
});
