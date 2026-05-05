# Project Dispatch — Framework Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 3 MVP-blocking framework enhancements for Project Dispatch: Serializable AgentConfig, Dynamic Tool Registration, and Subprocess Agent IPC.

**Architecture:** Each enhancement is an independent task that can be built and tested in isolation. Enhancement 1 (AgentConfig) touches `packages/runtime`. Enhancement 2 (Dynamic Tools) touches `packages/tools` and `packages/runtime`. Enhancement 3 (Subprocess IPC) creates a new module in `packages/runtime` and touches `packages/gateway`.

**Tech Stack:** TypeScript, Effect-TS, bun:test, Bun subprocess IPC

**Spec:** `docs/superpowers/specs/2026-03-15-project-dispatch-design.md`

---

## File Structure

### Enhancement 1: Serializable AgentConfig
```
packages/runtime/src/agent-config.ts          — AgentConfig schema, toJSON(), fromJSON(), toBuilder()
packages/runtime/tests/agent-config.test.ts   — Roundtrip serialization tests
packages/runtime/src/index.ts                 — Export AgentConfig types and functions
packages/runtime/src/builder.ts               — Add .toConfig() method to ReactiveAgentBuilder
```

### Enhancement 2: Dynamic Tool Registration
```
packages/tools/src/tool-service.ts            — Add unregisterTool() method to ToolService interface
packages/tools/tests/dynamic-registration.test.ts — Tests for post-build register/unregister
packages/runtime/src/builder.ts               — Add .registerTool() / .unregisterTool() to ReactiveAgent facade
```

### Enhancement 3: Subprocess Agent IPC
```
packages/runtime/src/subprocess/agent-process.ts    — AgentProcess class (spawn, send, on, kill)
packages/runtime/src/subprocess/ipc-protocol.ts     — Typed IPC message definitions
packages/runtime/src/subprocess/supervisor.ts        — Supervisor (spawn pool, heartbeat monitor, restart)
packages/runtime/src/subprocess/worker-entry.ts      — Child process entry point (receives config, runs agent)
packages/runtime/tests/subprocess/agent-process.test.ts  — AgentProcess spawn/IPC tests
packages/runtime/tests/subprocess/supervisor.test.ts     — Supervisor lifecycle tests
packages/runtime/src/index.ts                        — Export subprocess module
```

---

## Chunk 1: Serializable AgentConfig

### Task 1: Define the AgentConfig Schema

**Files:**
- Create: `packages/runtime/src/agent-config.ts`
- Test: `packages/runtime/tests/agent-config.test.ts`

The AgentConfig is a JSON-serializable representation of everything needed to reconstruct a ReactiveAgentBuilder. It maps 1:1 to RuntimeOptions but is designed for persistence and human readability.

- [ ] **Step 1: Write the failing test for AgentConfig schema**

```typescript
// packages/runtime/tests/agent-config.test.ts
import { describe, test, expect } from "bun:test";
import { AgentConfigSchema, type AgentConfig } from "../src/agent-config.js";
import { Schema } from "effect";

describe("AgentConfig", () => {
  describe("schema validation", () => {
    test("accepts minimal config", () => {
      const config: AgentConfig = {
        name: "test-agent",
        provider: "anthropic",
      };
      const result = Schema.decodeUnknownSync(AgentConfigSchema)(config);
      expect(result.name).toBe("test-agent");
      expect(result.provider).toBe("anthropic");
    });

    test("accepts full config", () => {
      const config: AgentConfig = {
        name: "research-agent",
        provider: "openai",
        model: "gpt-4o",
        systemPrompt: "You are a research assistant.",
        maxIterations: 15,
        thinking: true,
        temperature: 0.7,
        maxTokens: 4096,
        reasoning: {
          enabled: true,
          defaultStrategy: "plan-execute-reflect",
          strategySwitching: {
            enabled: true,
            maxSwitches: 2,
            fallbackStrategy: "react",
          },
        },
        tools: {
          enabled: true,
          allowedTools: ["web-search", "http-get"],
          adaptive: true,
          resultCompression: { budget: 2000, previewItems: 5 },
        },
        guardrails: {
          enabled: true,
          injectionThreshold: 0.8,
          piiThreshold: 0.9,
          toxicityThreshold: 0.7,
        },
        memory: {
          enabled: true,
          tier: "2",
        },
        schedule: "0 9 * * MON",
        persona: {
          name: "ResearchBot",
          role: "Research Assistant",
          instructions: "Be thorough and cite sources.",
          tone: "professional",
        },
      };
      const result = Schema.decodeUnknownSync(AgentConfigSchema)(config);
      expect(result.name).toBe("research-agent");
      expect(result.reasoning?.defaultStrategy).toBe("plan-execute-reflect");
      expect(result.tools?.allowedTools).toEqual(["web-search", "http-get"]);
      expect(result.schedule).toBe("0 9 * * MON");
    });

    test("rejects invalid provider", () => {
      expect(() =>
        Schema.decodeUnknownSync(AgentConfigSchema)({
          name: "test",
          provider: "invalid-provider",
        })
      ).toThrow();
    });

    test("rejects missing name", () => {
      expect(() =>
        Schema.decodeUnknownSync(AgentConfigSchema)({
          provider: "anthropic",
        })
      ).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — module `../src/agent-config.js` not found

- [ ] **Step 3: Implement the AgentConfig schema**

```typescript
// packages/runtime/src/agent-config.ts
import { Schema } from "effect";

/**
 * Provider names supported by the framework.
 */
const ProviderNameSchema = Schema.Literal(
  "anthropic",
  "openai",
  "ollama",
  "gemini",
  "litellm",
  "test",
);

/**
 * Persona configuration for agent behavior steering.
 */
const PersonaConfigSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  tone: Schema.optional(Schema.String),
});

/**
 * Reasoning configuration.
 */
const ReasoningConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  defaultStrategy: Schema.optional(
    Schema.Literal("react", "plan-execute-reflect", "tree-of-thought", "reflexion", "adaptive"),
  ),
  strategySwitching: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      maxSwitches: Schema.optional(Schema.Number),
      fallbackStrategy: Schema.optional(Schema.String),
    }),
  ),
});

/**
 * Tools configuration.
 */
const ToolsConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  resultCompression: Schema.optional(
    Schema.Struct({
      budget: Schema.optional(Schema.Number),
      previewItems: Schema.optional(Schema.Number),
      autoStore: Schema.optional(Schema.Boolean),
      codeTransform: Schema.optional(Schema.Boolean),
    }),
  ),
  requiredTools: Schema.optional(
    Schema.Struct({
      tools: Schema.optional(Schema.Array(Schema.String)),
      adaptive: Schema.optional(Schema.Boolean),
      maxRetries: Schema.optional(Schema.Number),
    }),
  ),
});

/**
 * Guardrails configuration.
 */
const GuardrailsConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  injectionThreshold: Schema.optional(Schema.Number),
  piiThreshold: Schema.optional(Schema.Number),
  toxicityThreshold: Schema.optional(Schema.Number),
});

/**
 * Memory configuration.
 */
const MemoryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  tier: Schema.optional(Schema.Literal("1", "2")),
  sessionPersist: Schema.optional(Schema.Boolean),
  sessionMaxAgeDays: Schema.optional(Schema.Number),
  experienceLearning: Schema.optional(Schema.Boolean),
  consolidation: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      threshold: Schema.optional(Schema.Number),
      decayFactor: Schema.optional(Schema.Number),
      pruneThreshold: Schema.optional(Schema.Number),
    }),
  ),
});

/**
 * Observability configuration.
 */
const ObservabilityConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  verbosity: Schema.optional(Schema.Literal("minimal", "normal", "verbose", "debug")),
  live: Schema.optional(Schema.Boolean),
});

/**
 * Cost tracking configuration.
 */
const CostTrackingConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  maxBudget: Schema.optional(Schema.Number),
  warnAt: Schema.optional(Schema.Number),
});

/**
 * Timeout and retry configuration.
 */
const ExecutionConfigSchema = Schema.Struct({
  timeoutMs: Schema.optional(Schema.Number),
  retryPolicy: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Number,
      backoffMs: Schema.Number,
    }),
  ),
  cacheTimeoutMs: Schema.optional(Schema.Number),
});

/**
 * Gateway configuration for persistent/scheduled agents.
 */
const GatewayConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  heartbeat: Schema.optional(
    Schema.Struct({
      intervalMs: Schema.optional(Schema.Number),
      policy: Schema.optional(Schema.Literal("fixed", "adaptive")),
    }),
  ),
  crons: Schema.optional(
    Schema.Array(
      Schema.Struct({
        schedule: Schema.String,
        instruction: Schema.String,
      }),
    ),
  ),
  webhooks: Schema.optional(Schema.Array(Schema.Unknown)),
  policies: Schema.optional(Schema.Unknown),
});

/**
 * MCP server configuration.
 */
const MCPServerConfigSchema = Schema.Struct({
  name: Schema.String,
  transport: Schema.optional(Schema.Literal("stdio", "sse", "streamable-http")),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
});

/**
 * Serializable agent configuration.
 *
 * This is the JSON-serializable representation of everything needed
 * to reconstruct a ReactiveAgentBuilder. Designed for persistence,
 * human readability, and roundtrip serialization.
 *
 * @example
 * ```typescript
 * const config: AgentConfig = {
 *   name: "github-monitor",
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   systemPrompt: "Monitor GitHub issues and summarize daily.",
 *   reasoning: { enabled: true, defaultStrategy: "plan-execute-reflect" },
 *   tools: { enabled: true, allowedTools: ["web-search", "http-get"] },
 *   schedule: "0 9 * * *",
 * };
 * ```
 */
export const AgentConfigSchema = Schema.Struct({
  /** Display name for the agent */
  name: Schema.String,
  /** LLM provider */
  provider: ProviderNameSchema,
  /** Specific model override */
  model: Schema.optional(Schema.String),
  /** System prompt / instructions */
  systemPrompt: Schema.optional(Schema.String),
  /** Max reasoning iterations */
  maxIterations: Schema.optional(Schema.Number),
  /** Enable thinking mode */
  thinking: Schema.optional(Schema.Boolean),
  /** LLM temperature */
  temperature: Schema.optional(Schema.Number),
  /** LLM max tokens */
  maxTokens: Schema.optional(Schema.Number),
  /** Agent persona */
  persona: Schema.optional(PersonaConfigSchema),
  /** Reasoning strategy configuration */
  reasoning: Schema.optional(ReasoningConfigSchema),
  /** Tool configuration */
  tools: Schema.optional(ToolsConfigSchema),
  /** Guardrails configuration */
  guardrails: Schema.optional(GuardrailsConfigSchema),
  /** Memory configuration */
  memory: Schema.optional(MemoryConfigSchema),
  /** Observability configuration */
  observability: Schema.optional(ObservabilityConfigSchema),
  /** Cost tracking configuration */
  costTracking: Schema.optional(CostTrackingConfigSchema),
  /** Execution timeout and retry */
  execution: Schema.optional(ExecutionConfigSchema),
  /** Gateway configuration (schedule, heartbeat, crons) */
  gateway: Schema.optional(GatewayConfigSchema),
  /** MCP servers to connect */
  mcpServers: Schema.optional(Schema.Array(MCPServerConfigSchema)),
  /** Cron schedule (shorthand for gateway.crons with single entry) */
  schedule: Schema.optional(Schema.String),
});

export type AgentConfig = typeof AgentConfigSchema.Type;
export type PersonaConfig = typeof PersonaConfigSchema.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add AgentConfig schema for serializable agent configuration"
```

---

### Task 2: Implement toJSON() and fromJSON() roundtrip

**Files:**
- Modify: `packages/runtime/src/agent-config.ts`
- Modify: `packages/runtime/tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing tests for toJSON/fromJSON**

Add to `packages/runtime/tests/agent-config.test.ts`:

```typescript
import {
  AgentConfigSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  type AgentConfig,
} from "../src/agent-config.js";

describe("serialization", () => {
  test("toJSON produces valid JSON string", () => {
    const config: AgentConfig = {
      name: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      reasoning: { enabled: true, defaultStrategy: "react" },
    };
    const json = agentConfigToJSON(config);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("test-agent");
    expect(parsed.reasoning.defaultStrategy).toBe("react");
  });

  test("fromJSON reconstructs config from JSON string", () => {
    const json = JSON.stringify({
      name: "test-agent",
      provider: "openai",
      maxIterations: 20,
      tools: { enabled: true, allowedTools: ["web-search"] },
    });
    const config = agentConfigFromJSON(json);
    expect(config.name).toBe("test-agent");
    expect(config.provider).toBe("openai");
    expect(config.maxIterations).toBe(20);
    expect(config.tools?.allowedTools).toEqual(["web-search"]);
  });

  test("roundtrip preserves all fields", () => {
    const original: AgentConfig = {
      name: "full-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      systemPrompt: "Be helpful.",
      maxIterations: 15,
      thinking: true,
      temperature: 0.7,
      maxTokens: 4096,
      persona: { role: "Assistant", tone: "friendly" },
      reasoning: {
        enabled: true,
        defaultStrategy: "plan-execute-reflect",
        strategySwitching: { enabled: true, maxSwitches: 2 },
      },
      tools: {
        enabled: true,
        allowedTools: ["web-search", "file-read"],
        adaptive: true,
      },
      guardrails: { enabled: true, injectionThreshold: 0.8 },
      memory: { enabled: true, tier: "2" },
      observability: { enabled: true, verbosity: "normal", live: true },
      schedule: "0 9 * * MON",
    };
    const json = agentConfigToJSON(original);
    const restored = agentConfigFromJSON(json);
    expect(restored).toEqual(original);
  });

  test("fromJSON throws on invalid JSON", () => {
    expect(() => agentConfigFromJSON("not json")).toThrow();
  });

  test("fromJSON throws on invalid config shape", () => {
    expect(() => agentConfigFromJSON(JSON.stringify({ provider: "anthropic" }))).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — `agentConfigToJSON` and `agentConfigFromJSON` not exported

- [ ] **Step 3: Implement toJSON and fromJSON**

Add to `packages/runtime/src/agent-config.ts`:

```typescript
import { Schema } from "effect";

// ... (existing schema code) ...

/**
 * Serialize an AgentConfig to a JSON string.
 *
 * Validates the config against the schema before serializing.
 * Strips undefined values for clean output.
 */
export function agentConfigToJSON(config: AgentConfig): string {
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config);
  return JSON.stringify(validated, null, 2);
}

/**
 * Deserialize a JSON string to a validated AgentConfig.
 *
 * @throws if the JSON is malformed or doesn't match the AgentConfig schema
 */
export function agentConfigFromJSON(json: string): AgentConfig {
  const raw = JSON.parse(json);
  return Schema.decodeUnknownSync(AgentConfigSchema)(raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 9 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add agentConfigToJSON/fromJSON for serialization roundtrip"
```

---

### Task 3: Implement agentConfigToBuilder() — config to builder reconstruction

**Files:**
- Modify: `packages/runtime/src/agent-config.ts`
- Modify: `packages/runtime/tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing test for agentConfigToBuilder**

Add to `packages/runtime/tests/agent-config.test.ts`:

```typescript
import { agentConfigToBuilder, type AgentConfig } from "../src/agent-config.js";
import { ReactiveAgents } from "../src/builder.js";

describe("agentConfigToBuilder", () => {
  test("produces a builder that can build an agent", async () => {
    const config: AgentConfig = {
      name: "test-agent",
      provider: "test",
      maxIterations: 5,
    };
    const builder = agentConfigToBuilder(config);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    await agent.dispose();
  });

  test("applies reasoning config", async () => {
    const config: AgentConfig = {
      name: "reasoning-agent",
      provider: "test",
      reasoning: {
        enabled: true,
        defaultStrategy: "react",
        strategySwitching: { enabled: true, maxSwitches: 1 },
      },
    };
    const builder = agentConfigToBuilder(config);
    // Builder should have reasoning enabled — verify by building successfully
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("applies tools config", async () => {
    const config: AgentConfig = {
      name: "tools-agent",
      provider: "test",
      tools: {
        enabled: true,
        allowedTools: ["web-search"],
        adaptive: true,
      },
    };
    const builder = agentConfigToBuilder(config);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("applies persona", async () => {
    const config: AgentConfig = {
      name: "persona-agent",
      provider: "test",
      persona: {
        role: "Research Assistant",
        tone: "professional",
      },
    };
    const builder = agentConfigToBuilder(config);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("applies guardrails config", async () => {
    const config: AgentConfig = {
      name: "guarded-agent",
      provider: "test",
      guardrails: {
        enabled: true,
        injectionThreshold: 0.8,
        piiThreshold: 0.9,
        toxicityThreshold: 0.7,
      },
    };
    const builder = agentConfigToBuilder(config);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("applies execution config", async () => {
    const config: AgentConfig = {
      name: "exec-agent",
      provider: "test",
      execution: {
        timeoutMs: 30_000,
        retryPolicy: { maxRetries: 3, backoffMs: 1_000 },
        cacheTimeoutMs: 3_600_000,
      },
    };
    const builder = agentConfigToBuilder(config);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("full roundtrip: config -> JSON -> config -> builder -> agent", async () => {
    const config: AgentConfig = {
      name: "roundtrip-agent",
      provider: "test",
      maxIterations: 8,
      systemPrompt: "You are helpful.",
      reasoning: { enabled: true, defaultStrategy: "react" },
      tools: { enabled: true },
      memory: { enabled: true, tier: "1" },
    };
    const json = agentConfigToJSON(config);
    const restored = agentConfigFromJSON(json);
    const builder = agentConfigToBuilder(restored);
    const agent = await builder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — `agentConfigToBuilder` not exported

- [ ] **Step 3: Implement agentConfigToBuilder**

Add to `packages/runtime/src/agent-config.ts`:

```typescript
import { ReactiveAgents, type ReactiveAgentBuilder } from "./builder.js";

/**
 * Reconstruct a ReactiveAgentBuilder from a serialized AgentConfig.
 *
 * Maps each config field to the corresponding builder method call.
 * The returned builder is ready to .build() — or can be further
 * customized with additional builder methods before building.
 */
export function agentConfigToBuilder(config: AgentConfig): ReactiveAgentBuilder {
  // Validate first
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config);

  let builder = ReactiveAgents.create()
    .withName(validated.name)
    .withProvider(validated.provider);

  // LLM settings
  if (validated.model) builder = builder.withModel(validated.model);
  if (validated.systemPrompt) builder = builder.withSystemPrompt(validated.systemPrompt);
  if (validated.maxIterations) builder = builder.withMaxIterations(validated.maxIterations);
  if (validated.thinking !== undefined) builder = builder.withThinking(validated.thinking);
  if (validated.temperature !== undefined) builder = builder.withTemperature(validated.temperature);
  if (validated.maxTokens !== undefined) builder = builder.withMaxTokens(validated.maxTokens);

  // Persona
  if (validated.persona) builder = builder.withPersona(validated.persona);

  // Reasoning
  if (validated.reasoning?.enabled) {
    const opts: Record<string, unknown> = {};
    if (validated.reasoning.defaultStrategy) opts.defaultStrategy = validated.reasoning.defaultStrategy;
    if (validated.reasoning.strategySwitching) {
      opts.enableStrategySwitching = validated.reasoning.strategySwitching.enabled;
      if (validated.reasoning.strategySwitching.maxSwitches !== undefined)
        opts.maxStrategySwitches = validated.reasoning.strategySwitching.maxSwitches;
      if (validated.reasoning.strategySwitching.fallbackStrategy)
        opts.fallbackStrategy = validated.reasoning.strategySwitching.fallbackStrategy;
    }
    builder = builder.withReasoning(opts);
  }

  // Tools
  if (validated.tools?.enabled) {
    const toolsOpts: Record<string, unknown> = {};
    if (validated.tools.allowedTools) toolsOpts.allowedTools = validated.tools.allowedTools;
    if (validated.tools.adaptive !== undefined) toolsOpts.adaptive = validated.tools.adaptive;
    if (validated.tools.resultCompression) toolsOpts.resultCompression = validated.tools.resultCompression;
    if (validated.tools.requiredTools) toolsOpts.requiredTools = validated.tools.requiredTools;
    builder = builder.withTools(toolsOpts);
  }

  // Guardrails
  if (validated.guardrails?.enabled) {
    const gOpts: Record<string, unknown> = {};
    if (validated.guardrails.injectionThreshold !== undefined)
      gOpts.injectionThreshold = validated.guardrails.injectionThreshold;
    if (validated.guardrails.piiThreshold !== undefined)
      gOpts.piiThreshold = validated.guardrails.piiThreshold;
    if (validated.guardrails.toxicityThreshold !== undefined)
      gOpts.toxicityThreshold = validated.guardrails.toxicityThreshold;
    builder = builder.withGuardrails(gOpts);
  }

  // Memory
  if (validated.memory?.enabled) {
    const memOpts: Record<string, unknown> = {};
    if (validated.memory.tier) memOpts.tier = validated.memory.tier;
    if (validated.memory.sessionPersist !== undefined) memOpts.sessionPersist = validated.memory.sessionPersist;
    if (validated.memory.sessionMaxAgeDays !== undefined)
      memOpts.sessionMaxAgeDays = validated.memory.sessionMaxAgeDays;
    builder = builder.withMemory(memOpts);
    if (validated.memory.experienceLearning) builder = builder.withExperienceLearning();
    if (validated.memory.consolidation?.enabled) {
      builder = builder.withMemoryConsolidation(validated.memory.consolidation);
    }
  }

  // Observability
  if (validated.observability?.enabled) {
    builder = builder.withObservability({
      verbosity: validated.observability.verbosity,
      live: validated.observability.live,
    });
  }

  // Cost tracking
  if (validated.costTracking?.enabled) {
    builder = builder.withCostTracking({
      maxBudget: validated.costTracking.maxBudget,
      warnAt: validated.costTracking.warnAt,
    });
  }

  // Execution config
  if (validated.execution?.timeoutMs) builder = builder.withTimeout(validated.execution.timeoutMs);
  if (validated.execution?.retryPolicy) builder = builder.withRetryPolicy(validated.execution.retryPolicy);
  if (validated.execution?.cacheTimeoutMs) builder = builder.withCacheTimeout(validated.execution.cacheTimeoutMs);

  // Gateway
  if (validated.gateway?.enabled) {
    builder = builder.withGateway({
      heartbeat: validated.gateway.heartbeat,
      crons: validated.gateway.crons,
      webhooks: validated.gateway.webhooks,
      policies: validated.gateway.policies,
    });
  }

  // Schedule shorthand (creates a gateway cron)
  if (validated.schedule && !validated.gateway?.enabled) {
    builder = builder.withGateway({
      crons: [{ schedule: validated.schedule, instruction: validated.systemPrompt ?? "Execute scheduled task" }],
    });
  }

  // MCP servers
  if (validated.mcpServers) {
    for (const server of validated.mcpServers) {
      builder = builder.withMCP(server);
    }
  }

  return builder;
}
```

Note: The exact builder method signatures may need adjustment based on the current API. The implementing agent should read `builder.ts` to verify each `.with*()` method's expected parameter type and adjust accordingly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 16 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add agentConfigToBuilder for config-to-builder reconstruction"
```

---

### Task 4: Add .toConfig() to ReactiveAgentBuilder and export from index

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing test for builder.toConfig()**

Add to `packages/runtime/tests/agent-config.test.ts`:

```typescript
describe("builder.toConfig()", () => {
  test("exports current builder state as AgentConfig", () => {
    const builder = ReactiveAgents.create()
      .withName("my-agent")
      .withProvider("anthropic")
      .withModel("claude-sonnet-4-20250514")
      .withMaxIterations(15)
      .withReasoning({ defaultStrategy: "react" });

    const config = builder.toConfig();
    expect(config.name).toBe("my-agent");
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.maxIterations).toBe(15);
    expect(config.reasoning?.enabled).toBe(true);
    expect(config.reasoning?.defaultStrategy).toBe("react");
  });

  test("toConfig output can be serialized and restored", async () => {
    const builder = ReactiveAgents.create()
      .withName("roundtrip")
      .withProvider("test")
      .withTools({ allowedTools: ["web-search"] })
      .withGuardrails({ injectionThreshold: 0.8 });

    const config = builder.toConfig();
    const json = agentConfigToJSON(config);
    const restored = agentConfigFromJSON(json);
    const newBuilder = agentConfigToBuilder(restored);
    const agent = await newBuilder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — `builder.toConfig is not a function`

- [ ] **Step 3: Add toConfig() method to ReactiveAgentBuilder**

In `packages/runtime/src/builder.ts`, add a `toConfig()` method to the `ReactiveAgentBuilder` class. This method reads the private `_*` fields and maps them to an `AgentConfig` object.

```typescript
// Add import at top of builder.ts
import type { AgentConfig } from "./agent-config.js";

// Add method to ReactiveAgentBuilder class
/**
 * Export the current builder state as a serializable AgentConfig.
 *
 * Useful for persisting agent configurations, displaying in UIs,
 * or transferring between systems.
 */
toConfig(): AgentConfig {
  const config: AgentConfig = {
    name: this._name,
    provider: this._provider,
  };

  if (this._model) config.model = this._model;
  if (this._systemPrompt) config.systemPrompt = this._systemPrompt;
  if (this._maxIterations !== 10) config.maxIterations = this._maxIterations;
  if (this._thinking !== undefined) config.thinking = this._thinking;
  if (this._temperature !== undefined) config.temperature = this._temperature;
  if (this._maxTokens !== undefined) config.maxTokens = this._maxTokens;
  if (this._persona) config.persona = this._persona;

  if (this._enableReasoning) {
    config.reasoning = {
      enabled: true,
      defaultStrategy: this._reasoningOptions?.defaultStrategy as AgentConfig["reasoning"] extends { defaultStrategy?: infer T } ? T : undefined,
      strategySwitching: this._reasoningOptions?.enableStrategySwitching
        ? {
            enabled: true,
            maxSwitches: this._reasoningOptions?.maxStrategySwitches,
            fallbackStrategy: this._reasoningOptions?.fallbackStrategy,
          }
        : undefined,
    };
  }

  if (this._enableTools) {
    config.tools = {
      enabled: true,
      allowedTools: this._toolsOptions?.allowedTools as string[] | undefined,
      adaptive: this._toolsOptions?.adaptive,
      resultCompression: this._resultCompression ?? undefined,
      requiredTools: this._requiredToolsConfig ?? undefined,
    };
  }

  if (this._enableGuardrails) {
    config.guardrails = {
      enabled: true,
      ...this._guardrailsOptions,
    };
  }

  if (this._enableMemory) {
    config.memory = {
      enabled: true,
      tier: this._memoryTier,
      sessionPersist: this._sessionPersist || undefined,
      sessionMaxAgeDays: this._sessionMaxAgeDays,
      experienceLearning: this._enableExperienceLearning || undefined,
      consolidation: this._enableMemoryConsolidation
        ? { enabled: true, ...this._consolidationConfig }
        : undefined,
    };
  }

  if (this._enableObservability) {
    config.observability = {
      enabled: true,
      verbosity: this._observabilityOptions?.verbosity,
      live: this._observabilityOptions?.live,
    };
  }

  if (this._enableCostTracking) {
    config.costTracking = {
      enabled: true,
      ...this._costTrackingOptions,
    };
  }

  if (this._executionTimeoutMs || this._retryPolicy || this._cacheTimeoutMs) {
    config.execution = {
      timeoutMs: this._executionTimeoutMs,
      retryPolicy: this._retryPolicy,
      cacheTimeoutMs: this._cacheTimeoutMs,
    };
  }

  if (this._gatewayOptions) {
    config.gateway = { enabled: true, ...this._gatewayOptions };
  }

  if (this._mcpServers.length > 0) {
    config.mcpServers = this._mcpServers;
  }

  return config;
}
```

Note: The exact field names on the private builder state need to be verified against the current source. The implementing agent should read the builder's private fields (lines 686-757 of builder.ts) and adjust the mapping.

- [ ] **Step 4: Add exports to index.ts**

In `packages/runtime/src/index.ts`, add:

```typescript
// ─── Agent Config (Serializable) ───
export {
  AgentConfigSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  agentConfigToBuilder,
} from "./agent-config.js";
export type { AgentConfig, PersonaConfig } from "./agent-config.js";
```

- [ ] **Step 5: Run all tests to verify**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 18 tests

- [ ] **Step 6: Build the package to verify compilation**

Run: `cd packages/runtime && bun run build`
Expected: Clean build, no type errors

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/agent-config.ts packages/runtime/src/index.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add builder.toConfig() and export AgentConfig from index"
```

---

## Chunk 2: Dynamic Tool Registration

### Task 5: Add unregisterTool to ToolService

**Files:**
- Modify: `packages/tools/src/tool-service.ts`
- Create: `packages/tools/tests/dynamic-registration.test.ts`

- [ ] **Step 1: Write the failing tests for dynamic registration**

```typescript
// packages/tools/tests/dynamic-registration.test.ts
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { ToolDefinition } from "../src/types.js";

const testLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const customTool: ToolDefinition = {
  name: "custom-test-tool",
  description: "A test tool for dynamic registration",
  parameters: [
    { name: "input", type: "string", description: "Test input", required: true },
  ],
  category: "custom",
  riskLevel: "low",
  source: "function",
  timeoutMs: 5000,
};

const customHandler = (args: Record<string, unknown>) =>
  Effect.succeed({ processed: args.input });

describe("Dynamic Tool Registration", () => {
  test("register adds a tool that can be listed", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        yield* ts.register(customTool, customHandler);
        const tools = yield* ts.listTools();
        return tools.find((t) => t.name === "custom-test-tool");
      }).pipe(Effect.provide(testLayer)),
    );
    expect(result).toBeDefined();
    expect(result!.name).toBe("custom-test-tool");
  });

  test("register adds a tool that can be executed", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        yield* ts.register(customTool, customHandler);
        return yield* ts.execute({
          toolName: "custom-test-tool",
          arguments: { input: "hello" },
          agentId: "test",
          sessionId: "test",
        });
      }).pipe(Effect.provide(testLayer)),
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ processed: "hello" });
  });

  test("unregisterTool removes a previously registered tool", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        yield* ts.register(customTool, customHandler);

        // Verify it exists
        const before = yield* ts.listTools();
        const foundBefore = before.find((t) => t.name === "custom-test-tool");

        // Unregister
        yield* ts.unregisterTool("custom-test-tool");

        // Verify it's gone
        const after = yield* ts.listTools();
        const foundAfter = after.find((t) => t.name === "custom-test-tool");

        return { foundBefore: !!foundBefore, foundAfter: !!foundAfter };
      }).pipe(Effect.provide(testLayer)),
    );
    expect(result.foundBefore).toBe(true);
    expect(result.foundAfter).toBe(false);
  });

  test("unregisterTool is a no-op for unknown tools", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        // Should not throw
        yield* ts.unregisterTool("nonexistent-tool");
      }).pipe(Effect.provide(testLayer)),
    );
  });

  test("cannot unregister builtin tools", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        yield* ts.unregisterTool("file-write");
        const tools = yield* ts.listTools();
        return tools.find((t) => t.name === "file-write");
      }).pipe(Effect.provide(testLayer)),
    );
    // file-write should still exist — builtins are protected
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tools && bun test tests/dynamic-registration.test.ts`
Expected: FAIL — `ts.unregisterTool is not a function`

- [ ] **Step 3: Add unregisterTool to ToolService interface**

In `packages/tools/src/tool-service.ts`, add to the ToolService Context.Tag type:

```typescript
/**
 * Remove a dynamically registered tool from the registry.
 *
 * Built-in tools (source: "builtin") are protected and cannot be unregistered.
 * No-op if the tool name is not found in the registry.
 *
 * @param name - The tool name to unregister
 */
readonly unregisterTool: (
  name: string,
) => Effect.Effect<void, never>;
```

- [ ] **Step 4: Implement unregisterTool in ToolServiceLive**

In the `ToolServiceLive` layer implementation within `tool-service.ts`, add the `unregisterTool` implementation. The implementing agent should find the `Layer.effect(ToolService, ...)` block and add:

```typescript
const unregisterTool = (name: string) =>
  Effect.gen(function* () {
    const current = yield* registry.get;
    const tool = current.get(name);
    // Protect builtin tools from removal
    if (tool && tool.definition.source === "builtin") return;
    if (tool) {
      const next = new Map(current);
      next.delete(name);
      yield* registry.set(next);
    }
  });
```

And include `unregisterTool` in the returned service object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/tools && bun test tests/dynamic-registration.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/tool-service.ts packages/tools/tests/dynamic-registration.test.ts
git commit -m "feat(tools): add unregisterTool for dynamic tool lifecycle management"
```

---

### Task 6: Add registerTool/unregisterTool to ReactiveAgent facade

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Create: `packages/runtime/tests/dynamic-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/tests/dynamic-tools.test.ts
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import { Effect } from "effect";

describe("ReactiveAgent dynamic tools", () => {
  test("registerTool adds a tool post-build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("dynamic-test")
      .withProvider("test")
      .withTools()
      .build();

    await agent.registerTool(
      {
        name: "dynamic-adder",
        description: "Adds two numbers",
        parameters: [
          { name: "a", type: "number", description: "First number", required: true },
          { name: "b", type: "number", description: "Second number", required: true },
        ],
        category: "custom",
        riskLevel: "low",
        source: "function",
        timeoutMs: 5000,
      },
      (args) => Effect.succeed({ sum: (args.a as number) + (args.b as number) }),
    );

    // Tool should now be available — we can't easily test execution
    // without running the agent, but we verify it doesn't throw
    await agent.dispose();
  });

  test("unregisterTool removes a tool post-build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("unreg-test")
      .withProvider("test")
      .withTools()
      .build();

    await agent.registerTool(
      {
        name: "temp-tool",
        description: "Temporary",
        parameters: [],
        category: "custom",
        riskLevel: "low",
        source: "function",
        timeoutMs: 5000,
      },
      () => Effect.succeed("ok"),
    );

    // Should not throw
    await agent.unregisterTool("temp-tool");
    await agent.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/dynamic-tools.test.ts`
Expected: FAIL — `agent.registerTool is not a function`

- [ ] **Step 3: Add registerTool/unregisterTool to ReactiveAgent**

In `packages/runtime/src/builder.ts`, find the `ReactiveAgent` class (or the facade object returned by `buildEffect`). Add two methods:

```typescript
/**
 * Register a custom tool at runtime (post-build).
 * The tool becomes immediately available for the agent's next execution.
 */
async registerTool(
  definition: ToolDefinition,
  handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>,
): Promise<void> {
  return this.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      yield* ts.register(definition, handler);
    }),
  );
}

/**
 * Remove a dynamically registered tool at runtime.
 * Built-in tools are protected and cannot be removed.
 */
async unregisterTool(name: string): Promise<void> {
  return this.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      yield* ts.unregisterTool(name);
    }),
  );
}
```

The implementing agent should verify the exact shape of the ReactiveAgent facade (it may be a class or a plain object returned in `buildEffect`) and add these methods accordingly. The ToolService import will also need to be added.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/dynamic-tools.test.ts`
Expected: PASS — all 2 tests

- [ ] **Step 5: Build to verify compilation**

Run: `cd packages/runtime && bun run build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/dynamic-tools.test.ts
git commit -m "feat(runtime): add registerTool/unregisterTool to ReactiveAgent facade"
```

---

## Chunk 3: Subprocess Agent IPC

### Task 7: Define IPC Protocol Types

**Files:**
- Create: `packages/runtime/src/subprocess/ipc-protocol.ts`

- [ ] **Step 1: Create the IPC message type definitions**

```typescript
// packages/runtime/src/subprocess/ipc-protocol.ts
import type { AgentEvent } from "@reactive-agents/core";
import type { AgentConfig } from "../agent-config.js";

// ─── Supervisor -> Runner Messages ───

export type SupervisorMessage =
  | SpawnConfigMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | PingMessage
  | UpdateConfigMessage;

export interface SpawnConfigMessage {
  readonly type: "spawn-config";
  readonly runnerId: string;
  readonly config: AgentConfig;
  readonly tools?: string[];
}

export interface PauseMessage {
  readonly type: "pause";
}

export interface ResumeMessage {
  readonly type: "resume";
}

export interface StopMessage {
  readonly type: "stop";
}

export interface PingMessage {
  readonly type: "ping";
  readonly ts: number;
}

export interface UpdateConfigMessage {
  readonly type: "update-config";
  readonly config: AgentConfig;
}

// ─── Runner -> Supervisor Messages ───

export type RunnerMessage =
  | ReadyMessage
  | PongMessage
  | EventMessage
  | RunStartedMessage
  | RunCompletedMessage
  | RunFailedMessage
  | FatalMessage;

export interface ReadyMessage {
  readonly type: "ready";
  readonly runnerId: string;
}

export interface PongMessage {
  readonly type: "pong";
  readonly ts: number;
  readonly uptimeMs: number;
}

export interface EventMessage {
  readonly type: "event";
  readonly runnerId: string;
  readonly event: AgentEvent;
}

export interface RunStartedMessage {
  readonly type: "run-started";
  readonly runnerId: string;
  readonly runId: string;
}

export interface RunCompletedMessage {
  readonly type: "run-completed";
  readonly runnerId: string;
  readonly runId: string;
  readonly result: unknown;
  readonly debrief?: unknown;
  readonly metrics?: unknown;
}

export interface RunFailedMessage {
  readonly type: "run-failed";
  readonly runnerId: string;
  readonly runId: string;
  readonly error: string;
}

export interface FatalMessage {
  readonly type: "fatal";
  readonly runnerId: string;
  readonly error: string;
}

// ─── Type Guards ───

export function isSupervisorMessage(msg: unknown): msg is SupervisorMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    typeof (msg as { type: unknown }).type === "string" &&
    ["spawn-config", "pause", "resume", "stop", "ping", "update-config"].includes(
      (msg as { type: string }).type,
    )
  );
}

export function isRunnerMessage(msg: unknown): msg is RunnerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    typeof (msg as { type: unknown }).type === "string" &&
    ["ready", "pong", "event", "run-started", "run-completed", "run-failed", "fatal"].includes(
      (msg as { type: string }).type,
    )
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/runtime/src/subprocess/ipc-protocol.ts
git commit -m "feat(runtime): define typed IPC protocol for subprocess agent communication"
```

---

### Task 8: Implement AgentProcess

**Files:**
- Create: `packages/runtime/src/subprocess/agent-process.ts`
- Create: `packages/runtime/tests/subprocess/agent-process.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/tests/subprocess/agent-process.test.ts
import { describe, test, expect } from "bun:test";
import { AgentProcess } from "../../src/subprocess/agent-process.js";
import type { AgentConfig } from "../../src/agent-config.js";

const testConfig: AgentConfig = {
  name: "test-subprocess",
  provider: "test",
  maxIterations: 3,
};

describe("AgentProcess", () => {
  test("spawn creates a child process", async () => {
    const proc = new AgentProcess("runner-1", testConfig);
    await proc.spawn();
    expect(proc.isAlive()).toBe(true);
    await proc.kill();
  });

  test("kill terminates the child process", async () => {
    const proc = new AgentProcess("runner-1", testConfig);
    await proc.spawn();
    expect(proc.isAlive()).toBe(true);
    await proc.kill();
    expect(proc.isAlive()).toBe(false);
  });

  test("send delivers a message to the child", async () => {
    const proc = new AgentProcess("runner-1", testConfig);
    await proc.spawn();
    // Ping should get a pong back
    const pongPromise = new Promise<{ ts: number; uptimeMs: number }>((resolve) => {
      proc.on("pong", (msg) => resolve(msg));
    });
    proc.send({ type: "ping", ts: Date.now() });
    const pong = await pongPromise;
    expect(pong.ts).toBeGreaterThan(0);
    expect(pong.uptimeMs).toBeGreaterThanOrEqual(0);
    await proc.kill();
  });

  test("on('ready') fires when child initializes", async () => {
    const proc = new AgentProcess("runner-1", testConfig);
    const readyPromise = new Promise<string>((resolve) => {
      proc.on("ready", (msg) => resolve(msg.runnerId));
    });
    await proc.spawn();
    const runnerId = await readyPromise;
    expect(runnerId).toBe("runner-1");
    await proc.kill();
  });

  test("on('fatal') fires on unrecoverable error", async () => {
    const badConfig: AgentConfig = {
      name: "bad-agent",
      provider: "nonexistent" as any,
    };
    const proc = new AgentProcess("runner-bad", badConfig);
    const fatalPromise = new Promise<string>((resolve) => {
      proc.on("fatal", (msg) => resolve(msg.error));
    });
    await proc.spawn();
    const error = await fatalPromise;
    expect(error).toBeTruthy();
    await proc.kill();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/subprocess/agent-process.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AgentProcess**

```typescript
// packages/runtime/src/subprocess/agent-process.ts
import type { Subprocess } from "bun";
import type { AgentConfig } from "../agent-config.js";
import type {
  SupervisorMessage,
  RunnerMessage,
  ReadyMessage,
  PongMessage,
  EventMessage,
  RunStartedMessage,
  RunCompletedMessage,
  RunFailedMessage,
  FatalMessage,
} from "./ipc-protocol.js";
import { isRunnerMessage } from "./ipc-protocol.js";

type RunnerMessageHandler<T extends RunnerMessage["type"]> = (
  msg: Extract<RunnerMessage, { type: T }>,
) => void;

/**
 * Manages a single agent running as an isolated Bun subprocess.
 *
 * Uses Bun's built-in IPC (serialization: "json") for typed message
 * passing between the supervisor (parent) and the agent (child).
 */
export class AgentProcess {
  private proc: Subprocess | null = null;
  private handlers = new Map<string, Set<(msg: any) => void>>();
  private startedAt: number = 0;

  constructor(
    public readonly runnerId: string,
    public config: AgentConfig,
  ) {}

  /**
   * Spawn the child process and send it the initial config.
   */
  async spawn(): Promise<void> {
    const workerPath = new URL("./worker-entry.js", import.meta.url).pathname;

    this.startedAt = Date.now();
    this.proc = Bun.spawn(["bun", "run", workerPath], {
      ipc: (message) => this.handleMessage(message),
      serialization: "json",
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env },
    });

    // Send initial config
    this.send({
      type: "spawn-config",
      runnerId: this.runnerId,
      config: this.config,
    });
  }

  /**
   * Send a typed message to the child process.
   */
  send(msg: SupervisorMessage): void {
    if (!this.proc) throw new Error(`AgentProcess ${this.runnerId} not spawned`);
    this.proc.send(msg);
  }

  /**
   * Register a handler for a specific runner message type.
   */
  on<T extends RunnerMessage["type"]>(type: T, handler: RunnerMessageHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    const set = this.handlers.get(type)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Check if the child process is still alive.
   */
  isAlive(): boolean {
    if (!this.proc) return false;
    return this.proc.exitCode === null;
  }

  /**
   * Gracefully stop the child process.
   * Sends a "stop" message first, then kills after timeout.
   */
  async kill(timeoutMs = 5000): Promise<void> {
    if (!this.proc) return;
    try {
      this.send({ type: "stop" });
    } catch {
      // Process may already be dead
    }
    const proc = this.proc;
    this.proc = null;

    // Wait for graceful exit or force kill
    const exitPromise = proc.exited;
    const timeout = setTimeout(() => proc.kill(), timeoutMs);
    await exitPromise;
    clearTimeout(timeout);
  }

  /**
   * Get uptime in milliseconds.
   */
  get uptimeMs(): number {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  private handleMessage(raw: unknown): void {
    if (!isRunnerMessage(raw)) return;
    const msg = raw as RunnerMessage;
    const set = this.handlers.get(msg.type);
    if (set) {
      for (const handler of set) handler(msg);
    }
  }
}
```

- [ ] **Step 4: Create the worker-entry.ts (child process entry point)**

```typescript
// packages/runtime/src/subprocess/worker-entry.ts
import type { SupervisorMessage, RunnerMessage } from "./ipc-protocol.js";
import { isSupervisorMessage } from "./ipc-protocol.js";
import { agentConfigToBuilder } from "../agent-config.js";
import type { AgentConfig } from "../agent-config.js";

let runnerId = "unknown";
let agent: any = null;
const startedAt = Date.now();

function send(msg: RunnerMessage): void {
  process.send?.(msg);
}

async function handleSpawnConfig(config: AgentConfig, id: string) {
  runnerId = id;
  try {
    const builder = agentConfigToBuilder(config);
    agent = await builder.build();
    send({ type: "ready", runnerId });
  } catch (err) {
    send({
      type: "fatal",
      runnerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleStop() {
  if (agent?.dispose) {
    await agent.dispose();
  }
  process.exit(0);
}

// Listen for messages from supervisor
process.on("message", async (raw: unknown) => {
  if (!isSupervisorMessage(raw)) return;
  const msg = raw as SupervisorMessage;

  switch (msg.type) {
    case "spawn-config":
      await handleSpawnConfig(msg.config, msg.runnerId);
      break;
    case "ping":
      send({ type: "pong", ts: msg.ts, uptimeMs: Date.now() - startedAt });
      break;
    case "pause":
      if (agent?.pause) await agent.pause();
      break;
    case "resume":
      if (agent?.resume) await agent.resume();
      break;
    case "stop":
      await handleStop();
      break;
    case "update-config":
      // Rebuild agent with new config
      if (agent?.dispose) await agent.dispose();
      await handleSpawnConfig(msg.config, runnerId);
      break;
  }
});

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  send({
    type: "fatal",
    runnerId,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/subprocess/agent-process.test.ts`
Expected: PASS — all 5 tests

Note: The "fatal" test may need adjustment depending on how Bun handles IPC with failing child processes. The implementing agent should debug any IPC-related failures.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/subprocess/agent-process.ts packages/runtime/src/subprocess/worker-entry.ts packages/runtime/tests/subprocess/agent-process.test.ts
git commit -m "feat(runtime): implement AgentProcess for subprocess agent management with typed IPC"
```

---

### Task 9: Implement Supervisor

**Files:**
- Create: `packages/runtime/src/subprocess/supervisor.ts`
- Create: `packages/runtime/tests/subprocess/supervisor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/tests/subprocess/supervisor.test.ts
import { describe, test, expect } from "bun:test";
import { Supervisor } from "../../src/subprocess/supervisor.js";
import type { AgentConfig } from "../../src/agent-config.js";

const testConfig: AgentConfig = {
  name: "supervised-agent",
  provider: "test",
  maxIterations: 3,
};

describe("Supervisor", () => {
  test("spawn adds a runner to the pool", async () => {
    const supervisor = new Supervisor({ maxRunners: 5, maxRestarts: 3 });
    await supervisor.spawnRunner("r1", testConfig);
    const status = supervisor.getStatus("r1");
    expect(status).toBeDefined();
    expect(status!.state).toBe("active");
    await supervisor.shutdown();
  });

  test("getRunners lists all active runners", async () => {
    const supervisor = new Supervisor({ maxRunners: 5, maxRestarts: 3 });
    await supervisor.spawnRunner("r1", testConfig);
    await supervisor.spawnRunner("r2", testConfig);
    const runners = supervisor.getRunners();
    expect(runners).toHaveLength(2);
    expect(runners.map((r) => r.runnerId).sort()).toEqual(["r1", "r2"]);
    await supervisor.shutdown();
  });

  test("stopRunner removes a runner", async () => {
    const supervisor = new Supervisor({ maxRunners: 5, maxRestarts: 3 });
    await supervisor.spawnRunner("r1", testConfig);
    await supervisor.stopRunner("r1");
    const status = supervisor.getStatus("r1");
    expect(status).toBeUndefined();
    await supervisor.shutdown();
  });

  test("enforces maxRunners limit", async () => {
    const supervisor = new Supervisor({ maxRunners: 2, maxRestarts: 3 });
    await supervisor.spawnRunner("r1", testConfig);
    await supervisor.spawnRunner("r2", testConfig);
    await expect(supervisor.spawnRunner("r3", testConfig)).rejects.toThrow(/max runners/i);
    await supervisor.shutdown();
  });

  test("shutdown stops all runners", async () => {
    const supervisor = new Supervisor({ maxRunners: 5, maxRestarts: 3 });
    await supervisor.spawnRunner("r1", testConfig);
    await supervisor.spawnRunner("r2", testConfig);
    await supervisor.shutdown();
    expect(supervisor.getRunners()).toHaveLength(0);
  });

  test("on('runner-error') fires when a runner fails", async () => {
    const supervisor = new Supervisor({ maxRunners: 5, maxRestarts: 3 });
    const errors: string[] = [];
    supervisor.on("runner-error", ({ runnerId }) => errors.push(runnerId));

    const badConfig: AgentConfig = {
      name: "bad",
      provider: "nonexistent" as any,
    };
    await supervisor.spawnRunner("rbad", badConfig);

    // Wait for the fatal event to propagate
    await new Promise((r) => setTimeout(r, 2000));

    // The supervisor should have received the error
    expect(errors.length).toBeGreaterThanOrEqual(1);
    await supervisor.shutdown();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/subprocess/supervisor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Supervisor**

```typescript
// packages/runtime/src/subprocess/supervisor.ts
import { AgentProcess } from "./agent-process.js";
import type { AgentConfig } from "../agent-config.js";
import type { RunnerMessage } from "./ipc-protocol.js";

export interface SupervisorOptions {
  /** Maximum concurrent runners (default: 10) */
  maxRunners: number;
  /** Max restart attempts before marking error (default: 3) */
  maxRestarts: number;
  /** Heartbeat interval in ms (default: 30_000) */
  heartbeatIntervalMs?: number;
  /** Heartbeat timeout in ms (default: 5_000) */
  heartbeatTimeoutMs?: number;
}

export interface RunnerStatus {
  runnerId: string;
  state: "starting" | "active" | "error" | "stopping";
  uptimeMs: number;
  consecutiveFailures: number;
  lastError?: string;
}

type SupervisorEventType = "runner-ready" | "runner-error" | "runner-event" | "runner-completed";

interface SupervisorEventPayload {
  "runner-ready": { runnerId: string };
  "runner-error": { runnerId: string; error: string; consecutiveFailures: number };
  "runner-event": { runnerId: string; event: unknown };
  "runner-completed": { runnerId: string; runId: string; result: unknown };
}

/**
 * Manages a pool of AgentProcess instances.
 *
 * Handles spawning, heartbeat monitoring, automatic restarts,
 * and error escalation.
 */
export class Supervisor {
  private runners = new Map<string, AgentProcess>();
  private failures = new Map<string, number>();
  private lastErrors = new Map<string, string>();
  private states = new Map<string, RunnerStatus["state"]>();
  private handlers = new Map<string, Set<(payload: any) => void>>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private options: Required<SupervisorOptions>;

  constructor(options: SupervisorOptions) {
    this.options = {
      heartbeatIntervalMs: 30_000,
      heartbeatTimeoutMs: 5_000,
      ...options,
    };
  }

  /**
   * Spawn a new runner subprocess.
   */
  async spawnRunner(runnerId: string, config: AgentConfig): Promise<void> {
    if (this.runners.size >= this.options.maxRunners) {
      throw new Error(`Cannot spawn: max runners limit (${this.options.maxRunners}) reached`);
    }
    if (this.runners.has(runnerId)) {
      throw new Error(`Runner ${runnerId} already exists`);
    }

    const proc = new AgentProcess(runnerId, config);
    this.runners.set(runnerId, proc);
    this.failures.set(runnerId, 0);
    this.states.set(runnerId, "starting");

    // Wire up event handlers
    proc.on("ready", () => {
      this.states.set(runnerId, "active");
      this.failures.set(runnerId, 0);
      this.emit("runner-ready", { runnerId });
    });

    proc.on("fatal", (msg) => {
      const count = (this.failures.get(runnerId) ?? 0) + 1;
      this.failures.set(runnerId, count);
      this.lastErrors.set(runnerId, msg.error);

      if (count >= this.options.maxRestarts) {
        this.states.set(runnerId, "error");
        this.emit("runner-error", {
          runnerId,
          error: msg.error,
          consecutiveFailures: count,
        });
      } else {
        // Auto-restart
        this.restartRunner(runnerId, config);
      }
    });

    proc.on("event", (msg) => {
      this.emit("runner-event", { runnerId, event: msg.event });
    });

    proc.on("run-completed", (msg) => {
      this.failures.set(runnerId, 0); // Reset on success
      this.emit("runner-completed", {
        runnerId,
        runId: msg.runId,
        result: msg.result,
      });
    });

    proc.on("run-failed", (msg) => {
      const count = (this.failures.get(runnerId) ?? 0) + 1;
      this.failures.set(runnerId, count);
      this.lastErrors.set(runnerId, msg.error);
    });

    await proc.spawn();
  }

  /**
   * Stop and remove a runner.
   */
  async stopRunner(runnerId: string): Promise<void> {
    const proc = this.runners.get(runnerId);
    if (!proc) return;
    this.states.set(runnerId, "stopping");
    await proc.kill();
    this.runners.delete(runnerId);
    this.failures.delete(runnerId);
    this.lastErrors.delete(runnerId);
    this.states.delete(runnerId);
  }

  /**
   * Get status of a specific runner.
   */
  getStatus(runnerId: string): RunnerStatus | undefined {
    const proc = this.runners.get(runnerId);
    if (!proc) return undefined;
    return {
      runnerId,
      state: this.states.get(runnerId) ?? "starting",
      uptimeMs: proc.uptimeMs,
      consecutiveFailures: this.failures.get(runnerId) ?? 0,
      lastError: this.lastErrors.get(runnerId),
    };
  }

  /**
   * List all runners.
   */
  getRunners(): RunnerStatus[] {
    return Array.from(this.runners.keys())
      .map((id) => this.getStatus(id))
      .filter((s): s is RunnerStatus => s !== undefined);
  }

  /**
   * Register an event handler.
   */
  on<T extends SupervisorEventType>(
    type: T,
    handler: (payload: SupervisorEventPayload[T]) => void,
  ): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    const set = this.handlers.get(type)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Start the heartbeat monitor.
   */
  startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      this.pingAll();
    }, this.options.heartbeatIntervalMs);
  }

  /**
   * Shutdown all runners and stop monitoring.
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    const stops = Array.from(this.runners.keys()).map((id) => this.stopRunner(id));
    await Promise.allSettled(stops);
  }

  private async restartRunner(runnerId: string, config: AgentConfig): Promise<void> {
    const proc = this.runners.get(runnerId);
    if (proc) {
      await proc.kill().catch(() => {});
      this.runners.delete(runnerId);
    }
    // Re-spawn with a small delay
    await new Promise((r) => setTimeout(r, 500));
    const newProc = new AgentProcess(runnerId, config);
    this.runners.set(runnerId, newProc);
    this.states.set(runnerId, "starting");

    // Re-wire handlers (same as spawnRunner)
    newProc.on("ready", () => {
      this.states.set(runnerId, "active");
      this.failures.set(runnerId, 0);
      this.emit("runner-ready", { runnerId });
    });
    newProc.on("fatal", (msg) => {
      const count = (this.failures.get(runnerId) ?? 0) + 1;
      this.failures.set(runnerId, count);
      this.lastErrors.set(runnerId, msg.error);
      if (count >= this.options.maxRestarts) {
        this.states.set(runnerId, "error");
        this.emit("runner-error", {
          runnerId,
          error: msg.error,
          consecutiveFailures: count,
        });
      } else {
        this.restartRunner(runnerId, config);
      }
    });

    await newProc.spawn();
  }

  private pingAll(): void {
    const ts = Date.now();
    for (const [id, proc] of this.runners) {
      if (proc.isAlive()) {
        try {
          proc.send({ type: "ping", ts });
        } catch {
          // Process may have died between check and send
        }
      }
    }
  }

  private emit<T extends SupervisorEventType>(
    type: T,
    payload: SupervisorEventPayload[T],
  ): void {
    const set = this.handlers.get(type);
    if (set) {
      for (const handler of set) handler(payload);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/subprocess/supervisor.test.ts`
Expected: PASS — all 6 tests

Note: The "runner-error" test has a 2s timeout wait. The implementing agent should adjust timing if Bun subprocess startup is slower than expected.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/subprocess/supervisor.ts packages/runtime/tests/subprocess/supervisor.test.ts
git commit -m "feat(runtime): implement Supervisor for process pool management with auto-restart"
```

---

### Task 10: Export subprocess module and final build verification

**Files:**
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Add subprocess exports to index.ts**

Add to `packages/runtime/src/index.ts`:

```typescript
// ─── Subprocess Agent IPC ───
export { AgentProcess } from "./subprocess/agent-process.js";
export { Supervisor } from "./subprocess/supervisor.js";
export type { SupervisorOptions, RunnerStatus } from "./subprocess/supervisor.js";
export type {
  SupervisorMessage,
  RunnerMessage,
  SpawnConfigMessage,
  ReadyMessage,
  PongMessage,
  EventMessage,
  RunStartedMessage,
  RunCompletedMessage,
  RunFailedMessage,
  FatalMessage,
} from "./subprocess/ipc-protocol.js";
```

- [ ] **Step 2: Run full test suite for runtime package**

Run: `cd packages/runtime && bun test`
Expected: All existing tests + new tests pass

- [ ] **Step 3: Build the package**

Run: `cd packages/runtime && bun run build`
Expected: Clean build, all new files compiled

- [ ] **Step 4: Run full project test suite**

Run: `bun test`
Expected: All 2194+ tests pass (plus new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/index.ts
git commit -m "feat(runtime): export subprocess module (AgentProcess, Supervisor, IPC protocol)"
```

- [ ] **Step 6: Final commit — build verification**

Run: `bun run build && bun test`

```bash
git add -A
git commit -m "chore: verify full build and test suite with all 3 framework enhancements"
```

---

## Summary

| Enhancement | Tasks | New Files | Tests |
|---|---|---|---|
| 1. Serializable AgentConfig | Tasks 1-4 | `agent-config.ts`, `agent-config.test.ts` | ~18 tests |
| 2. Dynamic Tool Registration | Tasks 5-6 | `dynamic-registration.test.ts`, `dynamic-tools.test.ts` | ~7 tests |
| 3. Subprocess Agent IPC | Tasks 7-10 | `ipc-protocol.ts`, `agent-process.ts`, `worker-entry.ts`, `supervisor.ts`, + 2 test files | ~11 tests |
| **Total** | **10 tasks** | **8 new files** | **~36 tests** |

All three enhancements are independent and can be implemented in parallel by separate agents.
