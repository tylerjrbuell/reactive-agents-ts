import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  ReactiveAgents,
  ReactiveAgent,
  createRuntime,
  ExecutionEngine,
} from "../src/index.js";

describe("Full Layer Integration", () => {
  it("should compose all optional layers via createRuntime()", async () => {
    const runtime = createRuntime({
      agentId: "integration-agent",
      provider: "test",
      memoryTier: "1",
      maxIterations: 5,
      enableGuardrails: true,
      enableVerification: true,
      enableCostTracking: true,
      enableReasoning: true,
      enableTools: true,
      enableIdentity: true,
      enableObservability: true,
      enableInteraction: true,
      enablePrompts: true,
      enableOrchestration: true,
      enableAudit: true,
    });

    // Verify the engine is accessible through the composed runtime
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return engine;
      }).pipe(Effect.provide(runtime)),
    );

    expect(result).toBeDefined();
    expect(typeof result.execute).toBe("function");
    expect(typeof result.registerHook).toBe("function");
    expect(typeof result.cancel).toBe("function");
    expect(typeof result.getContext).toBe("function");
  });

  it("should execute a task through runtime with all layers enabled", async () => {
    const runtime = createRuntime({
      agentId: "full-agent",
      provider: "test",
      enableGuardrails: true,
      enableVerification: true,
      enableCostTracking: true,
      enableReasoning: true,
      enableTools: true,
      enableIdentity: true,
      enableObservability: true,
      enableInteraction: true,
      enablePrompts: true,
      enableOrchestration: true,
      enableAudit: true,
      testResponses: {
        "What is": "The answer is 42.",
      },
    });

    const task = {
      id: "task-integration-001" as any,
      agentId: "full-agent" as any,
      type: "query" as const,
      input: { question: "What is the meaning of life?" },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(task);
      }).pipe(Effect.provide(runtime)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-integration-001");
    expect(result.metadata).toBeDefined();
  });

  it("should build a ReactiveAgent with all features via builder", async () => {
    const agent = await ReactiveAgents.create()
      .withName("full-featured-agent")
      .withProvider("test")
      .withModel("test-model")
      .withMemory("1")
      .withMaxIterations(5)
      .withGuardrails()
      .withVerification()
      .withCostTracking()
      .withReasoning()
      .withTools()
      .withIdentity()
      .withObservability()
      .withInteraction()
      .withPrompts()
      .withOrchestration()
      .withAudit()
      .withTestResponses({
        "Hello": "Hi there! How can I help you?",
      })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("full-featured-agent");
  });

  it("should run end-to-end through builder with all features", async () => {
    const agent = await ReactiveAgents.create()
      .withName("e2e-agent")
      .withProvider("test")
      .withModel("test-model")
      .withGuardrails()
      .withVerification()
      .withCostTracking()
      .withReasoning()
      .withTools()
      .withIdentity()
      .withObservability()
      .withInteraction()
      .withPrompts()
      .withOrchestration()
      .withAudit()
      .withTestResponses({
        "reasoning agent": "FINAL ANSWER: The answer is 42.",
      })
      .build();

    const result = await agent.run("What is the meaning of life?");

    expect(result.success).toBe(true);
    expect(result.agentId).toContain("e2e-agent");
    expect(typeof result.metadata.duration).toBe("number");
    expect(typeof result.metadata.stepsCount).toBe("number");
  });

  it("should work with minimal config (no optional features)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("minimal-agent")
      .withProvider("test")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);

    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("should work with selective features enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("selective-agent")
      .withProvider("test")
      .withGuardrails()
      .withPrompts()
      .withIdentity()
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);

    const result = await agent.run("Test query");
    expect(result.success).toBe(true);
  });
});
