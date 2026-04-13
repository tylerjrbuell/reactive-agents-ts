import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import { AgentConfigSchema } from "@reactive-agents/runtime";
import { buildCortexAgent } from "../services/build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";

describe("cortexParamsToAgentConfig", () => {
  it("maps required fields", () => {
    const config = cortexParamsToAgentConfig({
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(config.name).toBe("test-agent");
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("maps model params", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      temperature: 0.5,
      maxTokens: 2048,
    });
    expect(config.temperature).toBe(0.5);
    expect(config.maxTokens).toBe(2048);
  });

  it("maps reasoning fields", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      strategy: "plan-execute-reflect",
      maxIterations: 5,
      strategySwitching: true,
    });
    expect(config.reasoning?.defaultStrategy).toBe("plan-execute-reflect");
    expect(config.reasoning?.enableStrategySwitching).toBe(true);
    expect(config.execution?.maxIterations).toBe(5);
  });

  it("maps execution fields", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      timeout: 30000,
      cacheTimeout: 3600000,
      retryPolicy: { enabled: true, maxRetries: 3, backoffMs: 1000 },
    });
    expect(config.execution?.timeoutMs).toBe(30000);
    expect(config.execution?.cacheTimeoutMs).toBe(3600000);
    expect(config.execution?.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1000 });
  });

  it("retryPolicy is omitted when not enabled", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      retryPolicy: { enabled: false, maxRetries: 3 },
    });
    expect(config.execution?.retryPolicy).toBeUndefined();
  });

  it("maps tools allowlist", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      tools: ["web-search", "file-write"],
    });
    expect(config.tools?.allowedTools).toEqual(["web-search", "file-write"]);
  });

  it("maps memory tier: episodic/semantic → enhanced", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      memory: { episodic: true },
    });
    expect(config.memory?.tier).toBe("enhanced");
  });

  it("maps memory tier: working-only → standard", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      memory: { working: true },
    });
    expect(config.memory?.tier).toBe("standard");
  });

  it("maps guardrails thresholds → booleans", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      guardrails: { enabled: true, injectionThreshold: 0.8, piiThreshold: 0, toxicityThreshold: 0.5 },
    });
    expect(config.guardrails?.injection).toBe(true);
    expect(config.guardrails?.pii).toBe(false);
    expect(config.guardrails?.toxicity).toBe(true);
  });

  it("omits guardrails when not enabled", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      guardrails: { enabled: false, injectionThreshold: 0.8 },
    });
    expect(config.guardrails).toBeUndefined();
  });

  it("maps persona fields", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      persona: { enabled: true, role: "assistant", tone: "friendly", traits: "helpful", responseStyle: "concise" },
    });
    expect(config.persona?.role).toBe("assistant");
    expect(config.persona?.tone).toBe("friendly");
    expect(config.persona?.instructions).toBe("helpful\nResponse style: concise");
  });

  it("omits persona when not enabled", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      persona: { enabled: false, role: "assistant" },
    });
    expect(config.persona).toBeUndefined();
  });

  it("maps observability verbosity", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      observabilityVerbosity: "verbose",
    });
    expect(config.observability?.verbosity).toBe("verbose");
    expect(config.observability?.live).toBe(true);
    expect(config.logging?.level).toBe("debug");
  });

  it("maps fallbacks (drops enabled flag)", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      fallbacks: { enabled: true, providers: ["openai"], errorThreshold: 3 },
    });
    expect(config.fallbacks?.providers).toEqual(["openai"]);
    expect(config.fallbacks?.errorThreshold).toBe(3);
  });

  it("omits fallbacks when not enabled", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      fallbacks: { enabled: false, providers: ["openai"] },
    });
    expect(config.fallbacks).toBeUndefined();
  });

  it("maps mcpConfigs → mcpServers", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      mcpConfigs: [{ name: "my-server", transport: "stdio", command: "node", args: ["server.js"] }],
    });
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers?.[0]?.name).toBe("my-server");
  });

  it("maps healthCheck → features.healthCheck", () => {
    const config = cortexParamsToAgentConfig({
      provider: "anthropic",
      healthCheck: true,
    });
    expect(config.features?.healthCheck).toBe(true);
  });

  it("uses provider default name when agentName is absent", () => {
    const config = cortexParamsToAgentConfig({ provider: "anthropic" }, "fallback-name");
    expect(config.name).toBe("fallback-name");
  });
});

describe("buildCortexAgent round-trip", () => {
  it("builds an agent without errors for minimal params", async () => {
    const agent = await buildCortexAgent({ provider: "test" }, "smoke-test");
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
  });

  it("builds an agent with full cortex overlays", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      model: "test-model",
      strategy: "reactive",
      maxIterations: 3,
      minIterations: 1,
      contextSynthesis: "template",
      memory: { episodic: true },
      guardrails: { enabled: true, injectionThreshold: 0.8, piiThreshold: 0.5, toxicityThreshold: 0.7 },
      persona: { enabled: true, role: "assistant", tone: "helpful" },
      healthCheck: true,
      tools: ["web-search"],
      metaTools: { enabled: true, brief: true },
      taskContext: { project: "test" },
    });
    expect(agent).toBeDefined();
  });

  it("merges terminalShellAdditionalCommands into shell-execute allowlist (Cortex → builder)", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      strategy: "reactive",
      maxIterations: 4,
      tools: ["web-search"],
      terminalTools: true,
      terminalShellAdditionalCommands: "env",
      testScenario: [
        { toolCall: { name: "shell-execute", args: { command: "env" } } },
        { text: "done" },
      ],
    });
    try {
      const result = await agent.run("Invoke shell-execute with env");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("done");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("enables shell when only terminalShellAdditionalCommands is set (no terminalTools, no shell-execute in tools)", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      strategy: "reactive",
      maxIterations: 4,
      tools: ["web-search"],
      terminalShellAdditionalCommands: "env",
      testScenario: [
        { toolCall: { name: "shell-execute", args: { command: "env" } } },
        { text: "done" },
      ],
    });
    try {
      const result = await agent.run("Invoke shell-execute with env");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("done");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});

describe("cortexParamsToAgentConfig schema validation", () => {
  it("produces a valid AgentConfig for maximal params", () => {
    const config = cortexParamsToAgentConfig(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        temperature: 0.7,
        maxTokens: 4096,
        strategy: "reactive",
        maxIterations: 10,
        timeout: 60000,
        cacheTimeout: 3600000,
        retryPolicy: { enabled: true, maxRetries: 2, backoffMs: 500 },
        tools: ["web-search"],
        memory: { episodic: true },
        guardrails: { enabled: true, injectionThreshold: 0.8, piiThreshold: 0.5, toxicityThreshold: 0.7 },
        persona: { enabled: true, role: "analyst", tone: "professional", traits: "precise" },
        observabilityVerbosity: "normal",
        fallbacks: { enabled: true, providers: ["openai"], errorThreshold: 3 },
        mcpConfigs: [{ name: "fs-server", transport: "stdio", command: "node", args: ["server.js"] }],
        healthCheck: true,
        strategySwitching: true,
      },
      "maximal-test-agent",
    );

    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)(config)).not.toThrow();
  });

  it("produces a valid AgentConfig for minimal params", () => {
    const config = cortexParamsToAgentConfig({ provider: "test" }, "minimal-test");
    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)(config)).not.toThrow();
  });
});
