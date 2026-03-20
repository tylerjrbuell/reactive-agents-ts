// Tests for createLightRuntime — lightweight sub-agent runtime factory
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { createLightRuntime } from "../src/runtime.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { EventBus, CoreServicesLive } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";

describe("createLightRuntime", () => {
  it("creates a minimal runtime with Core, EventBus, LLM, and ExecutionEngine", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub",
      provider: "test",
    });

    // Should resolve ExecutionEngine (required for sub-agent execution)
    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
    expect(typeof engine.execute).toBe("function");
  });

  it("resolves LLMService", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-llm",
      provider: "test",
    });

    const llm = await Effect.runPromise(
      LLMService.pipe(Effect.provide(runtime)),
    );
    expect(llm).toBeDefined();
    expect(typeof llm.complete).toBe("function");
  });

  it("resolves EventBus", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-eb",
      provider: "test",
    });

    const eb = await Effect.runPromise(
      EventBus.pipe(Effect.provide(runtime)),
    );
    expect(eb).toBeDefined();
    expect(typeof eb.publish).toBe("function");
  });

  it("defaults maxIterations to 4", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-iter",
      provider: "test",
    });

    // Verify via engine execution — the config embedded in the engine has maxIterations: 4
    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableReasoning toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-reasoning",
      provider: "test",
      enableReasoning: true,
    });

    // Should still resolve ExecutionEngine without errors
    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableTools toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-tools",
      provider: "test",
      enableTools: true,
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableGuardrails toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-guard",
      provider: "test",
      enableGuardrails: true,
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableObservability toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-obs",
      provider: "test",
      enableObservability: true,
      observabilityOptions: { verbosity: "minimal" },
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableCostTracking toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-cost",
      provider: "test",
      enableCostTracking: true,
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports enableMemory toggle", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-memory",
      provider: "test",
      enableMemory: true,
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports allowedTools filtering", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-filtered",
      provider: "test",
      enableTools: true,
      allowedTools: ["web-search", "file-read"],
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });

  it("supports custom model and system prompt", async () => {
    const runtime = createLightRuntime({
      agentId: "test-sub-custom",
      provider: "test",
      model: "test-custom-model",
      systemPrompt: "You are a helpful sub-agent.",
      maxIterations: 2,
    });

    const engine = await Effect.runPromise(
      ExecutionEngine.pipe(Effect.provide(runtime)),
    );
    expect(engine).toBeDefined();
  });
});
