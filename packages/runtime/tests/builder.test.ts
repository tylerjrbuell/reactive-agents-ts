import { describe, it, expect } from "bun:test";
import {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "../src/index.js";

describe("ReactiveAgentBuilder", () => {
  it("should create a builder via ReactiveAgents.create()", () => {
    const builder = ReactiveAgents.create();
    expect(builder).toBeInstanceOf(ReactiveAgentBuilder);
  });

  it("should build a ReactiveAgent with test provider", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withModel("test-model")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("test-agent");
  });

  it("should run a task and return AgentResult", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withModel("test-model")
      .withTestResponses({
        "What is 2+2": "The answer is 4.",
      })
      .build();

    const result = await agent.run("What is 2+2?");

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.agentId).toContain("test-agent");
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata.duration).toBe("number");
    expect(typeof result.metadata.stepsCount).toBe("number");
  });

  it("withModel() accepts a ModelParams object with thinking/temperature/maxTokens", async () => {
    const agent = await ReactiveAgents.create()
      .withName("model-params-agent")
      .withProvider("test")
      .withModel({
        model: "test-model",
        thinking: true,
        temperature: 0.3,
        maxTokens: 2048,
      })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("model-params-agent");
  });

  it("withModel() still accepts a plain string", async () => {
    const agent = await ReactiveAgents.create()
      .withName("string-model-agent")
      .withProvider("test")
      .withModel("test-model")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("should support max iterations configuration", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withMaxIterations(5)
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("withTools() accepts resultCompression config", async () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withTools({
        resultCompression: {
          budget: 2000,
          previewItems: 8,
          autoStore: true,
          codeTransform: true,
        },
      });
    expect(builder).toBeDefined();
  });

  // ─── Sprint 3: Builder DX Overhaul ───

  describe("withMemory() DX overhaul", () => {
    it("accepts legacy string tier '1'", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory("1")
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts legacy string tier '2'", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory("2")
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts named options with tier: 'standard'", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory({ tier: "standard" })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts named options with tier: 'enhanced'", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory({ tier: "enhanced" })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts named options with all config fields", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory({
          tier: "standard",
          capacity: 12,
          evictionPolicy: "lru",
          maxEntries: 500,
          retainDays: 14,
          importanceThreshold: 0.5,
        })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts no arguments (default tier 1)", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withMemory()
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });
  });

  describe("withCostTracking() config passthrough", () => {
    it("accepts no arguments (default limits)", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withCostTracking()
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts budget limit options", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withCostTracking({ perRequest: 0.5, daily: 10.0, monthly: 100.0 })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });
  });

  describe("withGuardrails() config passthrough", () => {
    it("accepts no arguments (all detectors on)", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withGuardrails()
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts options to toggle individual detectors", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withGuardrails({ injection: true, pii: true, toxicity: false })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts customBlocklist", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withGuardrails({ customBlocklist: ["forbidden-word"] })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });
  });

  describe("withVerification() config passthrough", () => {
    it("accepts no arguments (default strategies)", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withVerification()
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });

    it("accepts options to toggle strategies and set thresholds", async () => {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withVerification({
          hallucinationDetection: true,
          hallucinationThreshold: 0.15,
          passThreshold: 0.8,
          semanticEntropy: false,
        })
        .build();
      expect(agent).toBeInstanceOf(ReactiveAgent);
    });
  });
});
