/**
 * Tests for AgentConfig schema, serialization, builder reconstruction, and reverse mapping.
 */
import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import {
  AgentConfigSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  agentConfigToBuilder,
  type AgentConfig,
} from "../src/agent-config.js";
import { ReactiveAgents } from "../src/builder.js";

// ─── Task 1: Schema Validation ────────────────────────────────────────────────

describe("AgentConfigSchema — validation", () => {
  test("accepts minimal config (name + provider)", () => {
    const config = Schema.decodeUnknownSync(AgentConfigSchema)({
      name: "my-agent",
      provider: "anthropic",
    });
    expect(config.name).toBe("my-agent");
    expect(config.provider).toBe("anthropic");
  });

  test("accepts full config with all sections", () => {
    const full = {
      name: "full-agent",
      provider: "openai",
      model: "gpt-4o",
      systemPrompt: "You are helpful.",
      thinking: false,
      temperature: 0.7,
      maxTokens: 4096,
      persona: {
        role: "Analyst",
        background: "Expert in data",
        instructions: "Always verify",
        tone: "professional",
      },
      reasoning: {
        defaultStrategy: "reactive" as const,
        enableStrategySwitching: true,
        maxStrategySwitches: 2,
        fallbackStrategy: "plan-execute-reflect",
      },
      tools: {
        allowedTools: ["web-search", "file-read"],
        adaptive: true,
      },
      guardrails: {
        injection: true,
        pii: true,
        toxicity: false,
        customBlocklist: ["badword"],
      },
      memory: {
        tier: "enhanced" as const,
        dbPath: "./memory.db",
        capacity: 10,
        experienceLearning: true,
        memoryConsolidation: false,
      },
      observability: {
        verbosity: "normal" as const,
        live: true,
        file: "./logs/agent.jsonl",
      },
      costTracking: {
        perRequest: 0.5,
        daily: 10.0,
        monthly: 100.0,
      },
      execution: {
        maxIterations: 15,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 3, backoffMs: 1000 },
        cacheTimeoutMs: 3600000,
        strictValidation: false,
      },
      gateway: {
        heartbeat: { intervalMs: 1800000, policy: "adaptive" as const },
        crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
        policies: { dailyTokenBudget: 50000 },
      },
      logging: {
        level: "info" as const,
        format: "json" as const,
        output: "console" as const,
      },
      fallbacks: {
        providers: ["anthropic", "openai"],
        errorThreshold: 3,
      },
      verification: {
        hallucinationDetection: true,
        passThreshold: 0.8,
      },
      features: {
        guardrails: true,
        reasoning: true,
        tools: true,
        memory: true,
        observability: true,
        costTracking: true,
        healthCheck: true,
      },
    };
    const config = Schema.decodeUnknownSync(AgentConfigSchema)(full);
    expect(config.name).toBe("full-agent");
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.reasoning?.defaultStrategy).toBe("reactive");
    expect(config.memory?.tier).toBe("enhanced");
    expect(config.execution?.maxIterations).toBe(15);
    expect(config.gateway?.heartbeat?.policy).toBe("adaptive");
  });

  test("rejects invalid provider", () => {
    expect(() =>
      Schema.decodeUnknownSync(AgentConfigSchema)({
        name: "agent",
        provider: "invalid-provider",
      }),
    ).toThrow();
  });

  test("rejects missing name", () => {
    expect(() =>
      Schema.decodeUnknownSync(AgentConfigSchema)({
        provider: "anthropic",
      }),
    ).toThrow();
  });

  test("rejects missing provider", () => {
    expect(() =>
      Schema.decodeUnknownSync(AgentConfigSchema)({
        name: "agent",
      }),
    ).toThrow();
  });
});

// ─── Task 2: Serialization ────────────────────────────────────────────────────

describe("agentConfigToJSON / agentConfigFromJSON — serialization", () => {
  test("roundtrip: minimal config", () => {
    const original: AgentConfig = { name: "agent", provider: "anthropic" };
    const json = agentConfigToJSON(original);
    const parsed = agentConfigFromJSON(json);
    expect(parsed.name).toBe("agent");
    expect(parsed.provider).toBe("anthropic");
  });

  test("roundtrip: config with reasoning and tools", () => {
    const original: AgentConfig = {
      name: "researcher",
      provider: "openai",
      model: "gpt-4o",
      reasoning: {
        defaultStrategy: "reactive",
        enableStrategySwitching: true,
        maxStrategySwitches: 2,
      },
      tools: { adaptive: true },
      features: { reasoning: true, tools: true },
    };
    const json = agentConfigToJSON(original);
    const parsed = agentConfigFromJSON(json);
    expect(parsed.reasoning?.enableStrategySwitching).toBe(true);
    expect(parsed.reasoning?.maxStrategySwitches).toBe(2);
    expect(parsed.tools?.adaptive).toBe(true);
  });

  test("toJSON produces valid pretty-printed JSON", () => {
    const config: AgentConfig = { name: "agent", provider: "test" };
    const json = agentConfigToJSON(config);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain("\n");
  });

  test("fromJSON throws on invalid JSON string", () => {
    expect(() => agentConfigFromJSON("not json")).toThrow();
  });

  test("fromJSON throws on JSON that fails schema validation", () => {
    const badJson = JSON.stringify({ name: "agent", provider: "unknown-provider" });
    expect(() => agentConfigFromJSON(badJson)).toThrow();
  });
});

// ─── Task 3: agentConfigToBuilder ────────────────────────────────────────────

describe("agentConfigToBuilder — builder reconstruction", () => {
  test("minimal config creates builder with name and provider", async () => {
    const config: AgentConfig = { name: "my-agent", provider: "test" };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._name).toBe("my-agent");
    expect((builder as any)._provider).toBe("test");
  });

  test("reasoning config maps to builder reasoning options", async () => {
    const config: AgentConfig = {
      name: "agent",
      provider: "test",
      reasoning: {
        defaultStrategy: "plan-execute-reflect",
        enableStrategySwitching: true,
        maxStrategySwitches: 2,
        fallbackStrategy: "reactive",
      },
      features: { reasoning: true },
    };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._enableReasoning).toBe(true);
    expect((builder as any)._reasoningOptions?.defaultStrategy).toBe("plan-execute-reflect");
    expect((builder as any)._reasoningOptions?.enableStrategySwitching).toBe(true);
    expect((builder as any)._reasoningOptions?.maxStrategySwitches).toBe(2);
  });

  test("tools config maps to builder tools options", async () => {
    const config: AgentConfig = {
      name: "agent",
      provider: "test",
      tools: { allowedTools: ["web-search", "file-read"], adaptive: true },
      features: { tools: true },
    };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._enableTools).toBe(true);
    expect((builder as any)._toolsOptions?.allowedTools).toEqual(["web-search", "file-read"]);
  });

  test("persona config maps to builder persona", async () => {
    const config: AgentConfig = {
      name: "agent",
      provider: "test",
      persona: {
        role: "Analyst",
        background: "Expert in data analysis",
        instructions: "Always validate",
        tone: "professional",
      },
    };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._persona?.role).toBe("Analyst");
    expect((builder as any)._persona?.background).toBe("Expert in data analysis");
  });

  test("execution config maps to builder execution options", async () => {
    const config: AgentConfig = {
      name: "agent",
      provider: "test",
      execution: {
        maxIterations: 20,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 3, backoffMs: 500 },
        cacheTimeoutMs: 3600000,
      },
    };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._maxIterations).toBe(20);
    expect((builder as any)._executionTimeoutMs).toBe(30000);
    expect((builder as any)._retryPolicy?.maxRetries).toBe(3);
    expect((builder as any)._cacheTimeoutMs).toBe(3600000);
  });

  test("full config roundtrip through builder", async () => {
    const config: AgentConfig = {
      name: "full-agent",
      provider: "test",
      model: "test-model",
      systemPrompt: "Be helpful.",
      reasoning: { defaultStrategy: "reactive" },
      tools: { adaptive: false },
      guardrails: { injection: true, pii: true },
      memory: { tier: "standard" },
      observability: { verbosity: "normal", live: false },
      execution: { maxIterations: 15 },
      features: {
        reasoning: true,
        tools: true,
        guardrails: true,
        memory: true,
        observability: true,
      },
    };
    const builder = await agentConfigToBuilder(config);
    expect((builder as any)._name).toBe("full-agent");
    expect((builder as any)._provider).toBe("test");
    expect((builder as any)._model).toBe("test-model");
    expect((builder as any)._systemPrompt).toBe("Be helpful.");
    expect((builder as any)._enableReasoning).toBe(true);
    expect((builder as any)._enableTools).toBe(true);
    expect((builder as any)._enableGuardrails).toBe(true);
    expect((builder as any)._enableMemory).toBe(true);
    expect((builder as any)._enableObservability).toBe(true);
    expect((builder as any)._maxIterations).toBe(15);
    expect((builder as any)._memoryTier).toBe("1");
  });
});

// ─── Task 4: toConfig() / fromConfig() / fromJSON() ──────────────────────────

describe("builder.toConfig() / ReactiveAgents.fromConfig() / fromJSON()", () => {
  test("builder.toConfig() returns valid AgentConfig", () => {
    const builder = ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools();
    const config = builder.toConfig();
    expect(config.name).toBe("test-agent");
    expect(config.provider).toBe("test");
    expect(config.features?.reasoning).toBe(true);
    expect(config.features?.tools).toBe(true);
  });

  test("ReactiveAgents.fromConfig() reconstructs builder from config", async () => {
    const config: AgentConfig = {
      name: "from-config-agent",
      provider: "test",
      reasoning: { defaultStrategy: "reactive" },
      features: { reasoning: true },
    };
    const builder = await ReactiveAgents.fromConfig(config);
    expect((builder as any)._name).toBe("from-config-agent");
    expect((builder as any)._enableReasoning).toBe(true);
  });

  test("ReactiveAgents.fromJSON() reconstructs builder from JSON string", async () => {
    const json = JSON.stringify({ name: "json-agent", provider: "test" });
    const builder = await ReactiveAgents.fromJSON(json);
    expect((builder as any)._name).toBe("json-agent");
    expect((builder as any)._provider).toBe("test");
  });

  test("builder toConfig() → fromConfig() roundtrip preserves core fields", async () => {
    const original = ReactiveAgents.create()
      .withName("roundtrip-agent")
      .withProvider("test")
      .withMaxIterations(20)
      .withReasoning({ defaultStrategy: "tree-of-thought" })
      .withTools({ adaptive: true })
      .withMemory({ tier: "enhanced" });
    const config = original.toConfig();
    const rebuilt = await ReactiveAgents.fromConfig(config);
    expect((rebuilt as any)._name).toBe("roundtrip-agent");
    expect((rebuilt as any)._maxIterations).toBe(20);
    expect((rebuilt as any)._reasoningOptions?.defaultStrategy).toBe("tree-of-thought");
    expect((rebuilt as any)._toolsOptions?.adaptive).toBe(true);
    expect((rebuilt as any)._memoryTier).toBe("2");
  });
});
