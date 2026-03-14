import { describe, it, expect } from "bun:test";
import { ReactiveAgents, ReactiveAgent } from "../src/index.js";

describe("Smoke: Builder Combinations", () => {
  it("minimal (provider only)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("minimal")
      .withProvider("test")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("tools only", async () => {
    const agent = await ReactiveAgents.create()
      .withName("tools-only")
      .withProvider("test")
      .withTools()
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("reasoning only", async () => {
    const agent = await ReactiveAgents.create()
      .withName("reasoning-only")
      .withTestScenario([{ text: "FINAL ANSWER: Hello back!" }])
      .withReasoning()
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("tools + reasoning", async () => {
    const agent = await ReactiveAgents.create()
      .withName("tools-reasoning")
      .withTestScenario([{ text: "FINAL ANSWER: Combined result." }])
      .withTools()
      .withReasoning()
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("full (all 11 optional features)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("full-featured")
      .withTestScenario([{ text: "FINAL ANSWER: Fully loaded." }])
      .withReasoning()
      .withTools()
      .withGuardrails()
      .withVerification()
      .withCostTracking()
      .withObservability()
      .withAudit()
      .withIdentity()
      .withInteraction()
      .withPrompts()
      .withOrchestration()
      .withMemory("1")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("with withSystemPrompt()", async () => {
    const agent = await ReactiveAgents.create()
      .withName("system-prompt")
      .withProvider("test")
      .withSystemPrompt("You are a pirate assistant.")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("with withMaxIterations(5)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("max-iter")
      .withProvider("test")
      .withMaxIterations(5)
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("with reasoning options (defaultStrategy)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("reasoning-options")
      .withTestScenario([{ text: "FINAL ANSWER: Strategy configured." }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });
});
