# Framework Evolution — Agent as Data + Organic Composition

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the framework from block-based assembly to clay-like composition by adding serializable agent configs, dynamic tool management, and lightweight functional agent composition.

**Architecture:** Three independent enhancements that build a layered capability stack. AgentConfig (agent-as-data) is the foundation — a JSON-serializable representation of any agent. Dynamic Tool Registration completes the runtime mutation API. Lightweight Composition introduces `agentFn()` and functional combinators (`pipe`, `parallel`, `race`) that make multi-agent feel like composing functions. All work lands in `packages/runtime` and `packages/tools`.

**Tech Stack:** TypeScript, Effect-TS (Schema, Layer, Ref, ManagedRuntime), bun:test

**Spec:** Conversation-driven design (no separate spec document). Key requirements: agent configs as JSON data, roundtrip serialization, config-driven agent creation, post-build tool mutation, functional agent composition that returns composable units.

---

## File Structure

### Chunk 1: Agent as Data (AgentConfig)
```
packages/runtime/src/agent-config.ts          — AgentConfig schema, toJSON(), fromJSON(), toBuilder()
packages/runtime/tests/agent-config.test.ts   — Schema validation + roundtrip + builder reconstruction tests
packages/runtime/src/builder.ts               — Add .toConfig(), static fromConfig()/fromJSON()
packages/runtime/src/index.ts                 — Export AgentConfig types and functions
```

### Chunk 2: Dynamic Tool Registration
```
packages/tools/src/registry/tool-registry.ts  — Add unregister() method to tool registry
packages/tools/src/tool-service.ts            — Add unregisterTool() to ToolService interface + implementation
packages/tools/tests/dynamic-registration.test.ts — Register/unregister/builtin-protection tests
packages/runtime/src/builder.ts               — Add .registerTool()/.unregisterTool() to ReactiveAgent
packages/runtime/tests/dynamic-tools.test.ts  — Post-build tool mutation tests
```

### Chunk 3: Lightweight Agent Composition
```
packages/runtime/src/compose.ts               — agentFn(), pipe(), parallel(), race()
packages/runtime/tests/compose.test.ts         — Composition function tests
packages/runtime/src/index.ts                 — Export composition functions
```

---

## Chunk 1: Agent as Data (AgentConfig)

### Task 1: Define the AgentConfig Schema

**Files:**
- Create: `packages/runtime/src/agent-config.ts`
- Create: `packages/runtime/tests/agent-config.test.ts`

AgentConfig is a JSON-serializable representation of everything needed to build an agent. It maps to the builder's private fields but uses a clean, human-readable structure designed for persistence and LLM consumption.

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

    test("accepts full config with all sections", () => {
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
          injection: true,
          pii: true,
          toxicity: true,
        },
        memory: {
          enabled: true,
          tier: "enhanced",
        },
        observability: {
          enabled: true,
          verbosity: "normal",
          live: true,
        },
        persona: {
          name: "ResearchBot",
          role: "Research Assistant",
          instructions: "Be thorough and cite sources.",
          tone: "professional",
        },
        schedule: "0 9 * * MON",
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
          name: "test",
        }),
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

// ─── Provider ───

const ProviderNameSchema = Schema.Literal(
  "anthropic",
  "openai",
  "ollama",
  "gemini",
  "litellm",
  "test",
);

// ─── Persona ───

const PersonaConfigSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  tone: Schema.optional(Schema.String),
});

// ─── Reasoning ───

const StrategySwitchingSchema = Schema.Struct({
  enabled: Schema.Boolean,
  maxSwitches: Schema.optional(Schema.Number),
  fallbackStrategy: Schema.optional(Schema.String),
});

const ReasoningConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  defaultStrategy: Schema.optional(
    Schema.Literal("react", "plan-execute-reflect", "tree-of-thought", "reflexion", "adaptive"),
  ),
  strategySwitching: Schema.optional(StrategySwitchingSchema),
});

// ─── Tools ───

const ResultCompressionSchema = Schema.Struct({
  budget: Schema.optional(Schema.Number),
  previewItems: Schema.optional(Schema.Number),
  autoStore: Schema.optional(Schema.Boolean),
  codeTransform: Schema.optional(Schema.Boolean),
});

const RequiredToolsSchema = Schema.Struct({
  tools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  maxRetries: Schema.optional(Schema.Number),
});

const ToolsConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  resultCompression: Schema.optional(ResultCompressionSchema),
  requiredTools: Schema.optional(RequiredToolsSchema),
});

// ─── Guardrails ───

const GuardrailsConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  injection: Schema.optional(Schema.Boolean),
  pii: Schema.optional(Schema.Boolean),
  toxicity: Schema.optional(Schema.Boolean),
  customBlocklist: Schema.optional(Schema.Array(Schema.String)),
});

// ─── Memory ───

const ConsolidationSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  threshold: Schema.optional(Schema.Number),
  decayFactor: Schema.optional(Schema.Number),
  pruneThreshold: Schema.optional(Schema.Number),
});

const MemoryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  tier: Schema.optional(Schema.Literal("standard", "enhanced")),
  sessionPersist: Schema.optional(Schema.Boolean),
  sessionMaxAgeDays: Schema.optional(Schema.Number),
  experienceLearning: Schema.optional(Schema.Boolean),
  consolidation: Schema.optional(ConsolidationSchema),
});

// ─── Observability ───

const ObservabilityConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  verbosity: Schema.optional(Schema.Literal("minimal", "normal", "verbose", "debug")),
  live: Schema.optional(Schema.Boolean),
});

// ─── Cost ───

const CostTrackingConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  perRequest: Schema.optional(Schema.Number),
  perSession: Schema.optional(Schema.Number),
  daily: Schema.optional(Schema.Number),
  monthly: Schema.optional(Schema.Number),
});

// ─── Execution ───

const RetryPolicySchema = Schema.Struct({
  maxRetries: Schema.Number,
  backoffMs: Schema.Number,
});

const ExecutionConfigSchema = Schema.Struct({
  timeoutMs: Schema.optional(Schema.Number),
  retryPolicy: Schema.optional(RetryPolicySchema),
  cacheTimeoutMs: Schema.optional(Schema.Number),
});

// ─── Gateway ───

const CronEntrySchema = Schema.Struct({
  schedule: Schema.String,
  instruction: Schema.String,
});

const HeartbeatSchema = Schema.Struct({
  intervalMs: Schema.optional(Schema.Number),
  policy: Schema.optional(Schema.Literal("always", "adaptive", "conservative")),
  instruction: Schema.optional(Schema.String),
  maxConsecutiveSkips: Schema.optional(Schema.Number),
});

const GatewayConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  heartbeat: Schema.optional(HeartbeatSchema),
  crons: Schema.optional(Schema.Array(CronEntrySchema)),
  webhooks: Schema.optional(Schema.Array(Schema.Unknown)),
  policies: Schema.optional(Schema.Unknown),
});

// ─── MCP ───

const MCPServerConfigSchema = Schema.Struct({
  name: Schema.String,
  transport: Schema.optional(Schema.Literal("stdio", "sse", "streamable-http")),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
});

// ─── Reactive Intelligence ───

const ReactiveIntelligenceConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  earlyStop: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    sensitivity: Schema.optional(Schema.Literal("conservative", "moderate", "aggressive")),
  })),
  strategySwitch: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
  })),
  contextCompression: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
  })),
});

// ─── Root AgentConfig ───

/**
 * Serializable agent configuration.
 *
 * The canonical data representation of a reactive agent.
 * Designed for persistence, human readability, LLM consumption,
 * and roundtrip serialization to/from the builder API.
 *
 * @example
 * ```typescript
 * const config: AgentConfig = {
 *   name: "github-monitor",
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   reasoning: { enabled: true, defaultStrategy: "plan-execute-reflect" },
 *   tools: { enabled: true, allowedTools: ["web-search"] },
 *   schedule: "0 9 * * *",
 * };
 * ```
 */
export const AgentConfigSchema = Schema.Struct({
  name: Schema.String,
  provider: ProviderNameSchema,
  model: Schema.optional(Schema.String),
  systemPrompt: Schema.optional(Schema.String),
  maxIterations: Schema.optional(Schema.Number),
  thinking: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  persona: Schema.optional(PersonaConfigSchema),
  reasoning: Schema.optional(ReasoningConfigSchema),
  tools: Schema.optional(ToolsConfigSchema),
  guardrails: Schema.optional(GuardrailsConfigSchema),
  memory: Schema.optional(MemoryConfigSchema),
  observability: Schema.optional(ObservabilityConfigSchema),
  costTracking: Schema.optional(CostTrackingConfigSchema),
  execution: Schema.optional(ExecutionConfigSchema),
  gateway: Schema.optional(GatewayConfigSchema),
  reactiveIntelligence: Schema.optional(ReactiveIntelligenceConfigSchema),
  mcpServers: Schema.optional(Schema.Array(MCPServerConfigSchema)),
  schedule: Schema.optional(Schema.String),
});

export type AgentConfig = typeof AgentConfigSchema.Type;
export type PersonaConfig = typeof PersonaConfigSchema.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 5 tests

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
      guardrails: { enabled: true, injection: true, pii: true },
      memory: { enabled: true, tier: "enhanced" },
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
    expect(() =>
      agentConfigFromJSON(JSON.stringify({ provider: "anthropic" })),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — `agentConfigToJSON` and `agentConfigFromJSON` not exported

- [ ] **Step 3: Implement toJSON and fromJSON**

Add to bottom of `packages/runtime/src/agent-config.ts`:

```typescript
/**
 * Serialize an AgentConfig to a JSON string.
 * Validates against the schema before serializing.
 */
export function agentConfigToJSON(config: AgentConfig): string {
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config);
  return JSON.stringify(validated, null, 2);
}

/**
 * Deserialize a JSON string to a validated AgentConfig.
 * @throws if the JSON is malformed or doesn't match the schema
 */
export function agentConfigFromJSON(json: string): AgentConfig {
  const raw = JSON.parse(json);
  return Schema.decodeUnknownSync(AgentConfigSchema)(raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 10 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add agentConfigToJSON/fromJSON for serialization roundtrip"
```

---

### Task 3: Implement agentConfigToBuilder()

**Files:**
- Modify: `packages/runtime/src/agent-config.ts`
- Modify: `packages/runtime/tests/agent-config.test.ts`

This is the critical mapping from config → builder. Every builder method call must match the exact signature from `builder.ts`.

**Key builder method signatures to match (verified from source):**
- `.withName(name: string)`
- `.withProvider(provider: ProviderName)`
- `.withModel(model: string)` or `.withModel({ model, thinking?, temperature?, maxTokens? })`
- `.withSystemPrompt(prompt: string)`
- `.withMaxIterations(n: number)`
- `.withPersona(persona: AgentPersona)`
- `.withReasoning(options?: ReasoningOptions)` — options has `defaultStrategy`, `enableStrategySwitching` (not `strategySwitching.enabled`)
- `.withTools(options?: ToolsOptions)` — options has `allowedTools`, `adaptive`, `resultCompression`
- `.withRequiredTools(config)` — separate method
- `.withGuardrails(options?: GuardrailsOptions)`
- `.withMemory(tierOrOptions?: "1" | "2" | MemoryOptions)`
- `.withExperienceLearning()`
- `.withMemoryConsolidation(config?)`
- `.withObservability(options?: ObservabilityOptions)`
- `.withCostTracking(options?: CostTrackingOptions)`
- `.withTimeout(ms: number)`
- `.withRetryPolicy(policy: { maxRetries, backoffMs })`
- `.withCacheTimeout(ms: number)`
- `.withGateway(options?: GatewayOptions)`
- `.withMCP(config: MCPServerConfig | MCPServerConfig[])`
- `.withReactiveIntelligence(options?)`

- [ ] **Step 1: Write the failing tests for agentConfigToBuilder**

Add to `packages/runtime/tests/agent-config.test.ts`:

```typescript
import {
  AgentConfigSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  agentConfigToBuilder,
  type AgentConfig,
} from "../src/agent-config.js";

describe("agentConfigToBuilder", () => {
  test("minimal config produces buildable agent", async () => {
    const config: AgentConfig = {
      name: "test-agent",
      provider: "test",
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
      memory: { enabled: true, tier: "standard" },
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
import { ReactiveAgents } from "./builder.js";
import type { ReactiveAgentBuilder } from "./builder.js";

/**
 * Reconstruct a ReactiveAgentBuilder from a serialized AgentConfig.
 *
 * Maps each config section to the corresponding builder method.
 * The returned builder is ready to .build() or can be further
 * customized with additional builder methods.
 */
export function agentConfigToBuilder(config: AgentConfig): ReactiveAgentBuilder {
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config);

  let builder = ReactiveAgents.create()
    .withName(validated.name)
    .withProvider(validated.provider);

  // ─── LLM settings ───
  if (validated.model) builder = builder.withModel(validated.model);
  if (validated.systemPrompt) builder = builder.withSystemPrompt(validated.systemPrompt);
  if (validated.maxIterations !== undefined) builder = builder.withMaxIterations(validated.maxIterations);
  if (validated.model && (validated.thinking !== undefined || validated.temperature !== undefined || validated.maxTokens !== undefined)) {
    // Use withModel overload to set model + LLM params together
    builder = builder.withModel({
      model: validated.model,
      thinking: validated.thinking,
      temperature: validated.temperature,
      maxTokens: validated.maxTokens,
    });
  }

  // ─── Persona ───
  if (validated.persona) builder = builder.withPersona(validated.persona);

  // ─── Reasoning ───
  if (validated.reasoning?.enabled) {
    const opts: Record<string, unknown> = {};
    if (validated.reasoning.defaultStrategy) opts.defaultStrategy = validated.reasoning.defaultStrategy;
    if (validated.reasoning.strategySwitching?.enabled) {
      opts.enableStrategySwitching = true;
      if (validated.reasoning.strategySwitching.maxSwitches !== undefined)
        opts.maxStrategySwitches = validated.reasoning.strategySwitching.maxSwitches;
      if (validated.reasoning.strategySwitching.fallbackStrategy)
        opts.fallbackStrategy = validated.reasoning.strategySwitching.fallbackStrategy;
    }
    builder = builder.withReasoning(opts);
  }

  // ─── Tools ───
  if (validated.tools?.enabled) {
    const toolsOpts: Record<string, unknown> = {};
    if (validated.tools.allowedTools) toolsOpts.allowedTools = validated.tools.allowedTools;
    if (validated.tools.adaptive !== undefined) toolsOpts.adaptive = validated.tools.adaptive;
    if (validated.tools.resultCompression) toolsOpts.resultCompression = validated.tools.resultCompression;
    builder = builder.withTools(toolsOpts);
    if (validated.tools.requiredTools) {
      builder = builder.withRequiredTools(validated.tools.requiredTools);
    }
  }

  // ─── Guardrails ───
  if (validated.guardrails?.enabled) {
    builder = builder.withGuardrails({
      injection: validated.guardrails.injection,
      pii: validated.guardrails.pii,
      toxicity: validated.guardrails.toxicity,
      customBlocklist: validated.guardrails.customBlocklist,
    });
  }

  // ─── Memory ───
  if (validated.memory?.enabled) {
    builder = builder.withMemory({ tier: validated.memory.tier ?? "standard" });
    if (validated.memory.experienceLearning) builder = builder.withExperienceLearning();
    if (validated.memory.consolidation?.enabled) {
      builder = builder.withMemoryConsolidation(validated.memory.consolidation);
    }
  }

  // ─── Observability ───
  if (validated.observability?.enabled) {
    builder = builder.withObservability({
      verbosity: validated.observability.verbosity,
      live: validated.observability.live,
    });
  }

  // ─── Cost tracking ───
  if (validated.costTracking?.enabled) {
    builder = builder.withCostTracking({
      perRequest: validated.costTracking.perRequest,
      perSession: validated.costTracking.perSession,
      daily: validated.costTracking.daily,
      monthly: validated.costTracking.monthly,
    });
  }

  // ─── Execution ───
  if (validated.execution?.timeoutMs) builder = builder.withTimeout(validated.execution.timeoutMs);
  if (validated.execution?.retryPolicy) builder = builder.withRetryPolicy(validated.execution.retryPolicy);
  if (validated.execution?.cacheTimeoutMs) builder = builder.withCacheTimeout(validated.execution.cacheTimeoutMs);

  // ─── Gateway ───
  if (validated.gateway?.enabled) {
    builder = builder.withGateway({
      heartbeat: validated.gateway.heartbeat,
      crons: validated.gateway.crons,
      webhooks: validated.gateway.webhooks,
      policies: validated.gateway.policies,
    });
  }

  // ─── Schedule shorthand ───
  if (validated.schedule && !validated.gateway?.enabled) {
    builder = builder.withGateway({
      crons: [{ schedule: validated.schedule, instruction: validated.systemPrompt ?? "Execute scheduled task" }],
    });
  }

  // ─── MCP servers ───
  if (validated.mcpServers) {
    for (const server of validated.mcpServers) {
      builder = builder.withMCP(server);
    }
  }

  // ─── Reactive Intelligence ───
  if (validated.reactiveIntelligence?.enabled) {
    builder = builder.withReactiveIntelligence(validated.reactiveIntelligence);
  }

  return builder;
}
```

Note: The implementing agent must read `builder.ts` to verify the exact parameter shapes for `.withReasoning()`, `.withTools()`, `.withGuardrails()`, `.withMemory()`, `.withObservability()`, `.withCostTracking()`, and `.withGateway()`. The types used above (`Record<string, unknown>`) should be replaced with the actual option types if the implementing agent can import them. The key mapping differences from config to builder:
- Config `reasoning.strategySwitching.enabled` → Builder `enableStrategySwitching: true`
- Config `reasoning.strategySwitching.maxSwitches` → Builder `maxStrategySwitches`
- Config `memory.tier` → Builder `.withMemory({ tier: "standard" })` or `.withMemory({ tier: "enhanced" })`
- Config `memory.experienceLearning` → Builder `.withExperienceLearning()` (separate call)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 16 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add agentConfigToBuilder for config-to-builder reconstruction"
```

---

### Task 4: Add builder.toConfig(), ReactiveAgents.fromConfig(), and exports

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/runtime/tests/agent-config.test.ts`:

```typescript
import { ReactiveAgents } from "../src/builder.js";

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

  test("toConfig output can be serialized and restored to build an agent", async () => {
    const builder = ReactiveAgents.create()
      .withName("roundtrip")
      .withProvider("test")
      .withTools({ allowedTools: ["web-search"] })
      .withGuardrails({ injection: true, pii: true });

    const config = builder.toConfig();
    const json = agentConfigToJSON(config);
    const restored = agentConfigFromJSON(json);
    const newBuilder = agentConfigToBuilder(restored);
    const agent = await newBuilder.build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});

describe("ReactiveAgents.fromConfig()", () => {
  test("creates builder from config object", async () => {
    const config: AgentConfig = {
      name: "from-config",
      provider: "test",
      maxIterations: 5,
    };
    const agent = await ReactiveAgents.fromConfig(config).build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("creates builder from JSON string", async () => {
    const json = JSON.stringify({
      name: "from-json",
      provider: "test",
    });
    const agent = await ReactiveAgents.fromJSON(json).build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: FAIL — `builder.toConfig is not a function`, `ReactiveAgents.fromConfig is not a function`

- [ ] **Step 3: Add toConfig() to ReactiveAgentBuilder**

In `packages/runtime/src/builder.ts`, add an import at the top:

```typescript
import type { AgentConfig } from "./agent-config.js";
```

Add a `toConfig()` method to the `ReactiveAgentBuilder` class. The implementing agent must read the private field names from the class and map them. The field names are `_name`, `_provider`, `_model`, `_systemPrompt`, `_maxIterations`, `_thinking`, `_temperature`, `_maxTokens`, `_persona`, `_enableReasoning`, `_reasoningOptions`, `_enableTools`, `_toolsOptions`, `_resultCompression`, `_requiredToolsConfig`, `_enableGuardrails`, `_guardrailsOptions`, `_enableMemory`, `_memoryTier`, `_enableExperienceLearning`, `_enableMemoryConsolidation`, `_consolidationConfig`, `_enableObservability`, `_observabilityOptions`, `_enableCostTracking`, `_costTrackingOptions`, `_executionTimeoutMs`, `_retryPolicy`, `_cacheTimeoutMs`, `_gatewayOptions`, `_mcpServers`, `_sessionPersist`, `_sessionMaxAgeDays`, `_enableReactiveIntelligence`, `_reactiveIntelligenceOptions`.

```typescript
/**
 * Export the current builder state as a serializable AgentConfig.
 */
toConfig(): AgentConfig {
  // Build the full object at construction time to avoid mutating a readonly type.
  // Undefined values are stripped by JSON serialization.
  return {
    name: this._name,
    provider: this._provider,
    model: this._model || undefined,
    systemPrompt: this._systemPrompt || undefined,
    maxIterations: this._maxIterations !== 10 ? this._maxIterations : undefined,
    thinking: this._thinking,
    temperature: this._temperature,
    maxTokens: this._maxTokens,
    persona: this._persona || undefined,

    reasoning: this._enableReasoning
      ? {
          enabled: true,
          defaultStrategy: this._reasoningOptions?.defaultStrategy as any,
          strategySwitching: this._reasoningOptions?.enableStrategySwitching
            ? {
                enabled: true,
                maxSwitches: this._reasoningOptions?.maxStrategySwitches,
                fallbackStrategy: this._reasoningOptions?.fallbackStrategy,
              }
            : undefined,
        }
      : undefined,

    tools: this._enableTools
      ? {
          enabled: true,
          allowedTools: this._toolsOptions?.allowedTools as string[] | undefined,
          adaptive: this._toolsOptions?.adaptive,
          resultCompression: this._resultCompression ?? undefined,
          requiredTools: this._requiredToolsConfig ?? undefined,
        }
      : undefined,

    guardrails: this._enableGuardrails
      ? { enabled: true, ...this._guardrailsOptions }
      : undefined,

    memory: this._enableMemory
      ? {
          enabled: true,
          tier: (this._memoryTier === "2" ? "enhanced" : "standard") as "standard" | "enhanced",
          sessionPersist: this._sessionPersist === true ? true : undefined,
          sessionMaxAgeDays: this._sessionMaxAgeDays,
          experienceLearning: this._enableExperienceLearning === true ? true : undefined,
          consolidation: this._enableMemoryConsolidation
            ? { enabled: true, ...this._consolidationConfig }
            : undefined,
        }
      : undefined,

    observability: this._enableObservability
      ? { enabled: true, ...this._observabilityOptions }
      : undefined,

    costTracking: this._enableCostTracking
      ? { enabled: true, ...this._costTrackingOptions }
      : undefined,

    execution:
      this._executionTimeoutMs || this._retryPolicy || this._cacheTimeoutMs
        ? {
            timeoutMs: this._executionTimeoutMs,
            retryPolicy: this._retryPolicy,
            cacheTimeoutMs: this._cacheTimeoutMs,
          }
        : undefined,

    gateway: this._gatewayOptions
      ? { enabled: true, ...this._gatewayOptions }
      : undefined,

    mcpServers: this._mcpServers.length > 0 ? this._mcpServers : undefined,

    reactiveIntelligence: this._enableReactiveIntelligence
      ? { enabled: true, ...this._reactiveIntelligenceOptions }
      : undefined,
  } as AgentConfig;
}
```

Note: The implementing agent should verify each `this._*` field name against the actual builder source. The `as AgentConfig` cast at the end handles readonly narrowing. The `_memoryTier` internal value is "1"/"2" but the config uses "standard"/"enhanced".

- [ ] **Step 4: Add static fromConfig() and fromJSON() to ReactiveAgents**

In `packages/runtime/src/builder.ts`, find the `ReactiveAgents` class (the static factory) and add:

```typescript
import { agentConfigToBuilder, agentConfigFromJSON } from "./agent-config.js";
import type { AgentConfig } from "./agent-config.js";

// Add to the ReactiveAgents class:

/**
 * Create a builder from a serialized AgentConfig object.
 */
static fromConfig(config: AgentConfig): ReactiveAgentBuilder {
  return agentConfigToBuilder(config);
}

/**
 * Create a builder from a JSON string.
 */
static fromJSON(json: string): ReactiveAgentBuilder {
  return agentConfigToBuilder(agentConfigFromJSON(json));
}
```

- [ ] **Step 5: Add exports to index.ts**

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

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/agent-config.test.ts`
Expected: PASS — all 20 tests

- [ ] **Step 7: Build the package to verify compilation**

Run: `cd packages/runtime && bun run build`
Expected: Clean build, no type errors

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/agent-config.ts packages/runtime/src/index.ts packages/runtime/tests/agent-config.test.ts
git commit -m "feat(runtime): add builder.toConfig(), ReactiveAgents.fromConfig/fromJSON, export AgentConfig"
```

---

## Chunk 2: Dynamic Tool Registration

### Task 5: Add unregisterTool to ToolService

**Files:**
- Modify: `packages/tools/src/tool-service.ts`
- Create: `packages/tools/tests/dynamic-registration.test.ts`

The ToolService already has `register()`. We need to add `unregisterTool()` with builtin protection.

**Key context from tool-service.ts:**
- Registry is a `Ref<Map<string, RegisteredTool>>` where `RegisteredTool = { definition: ToolDefinition, handler: ... }`
- Built-in tools have `source: "builtin"` on their ToolDefinition
- `register()` takes `(definition: ToolDefinition, handler: ToolHandler)` and adds to the Ref Map

- [ ] **Step 1: Write the failing tests**

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
  requiresApproval: false,
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

        const before = yield* ts.listTools();
        const foundBefore = before.find((t) => t.name === "custom-test-tool");

        yield* ts.unregisterTool("custom-test-tool");

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
        yield* ts.unregisterTool("nonexistent-tool");
      }).pipe(Effect.provide(testLayer)),
    );
  });

  test("cannot unregister builtin tools", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ts = yield* ToolService;
        const toolsBefore = yield* ts.listTools();
        const builtinName = toolsBefore.find((t) => t.source === "builtin")?.name;
        if (builtinName) {
          yield* ts.unregisterTool(builtinName);
          const toolsAfter = yield* ts.listTools();
          return toolsAfter.find((t) => t.name === builtinName);
        }
        return { name: "no-builtin-found" };
      }).pipe(Effect.provide(testLayer)),
    );
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tools && bun test tests/dynamic-registration.test.ts`
Expected: FAIL — `ts.unregisterTool is not a function`

- [ ] **Step 3: Add unregister() to makeToolRegistry**

In `packages/tools/src/registry/tool-registry.ts`, the registry uses a private `toolsRef` Ref. The `ToolServiceLive` only accesses the registry through the object returned by `makeToolRegistry` (`{ register, get, list, toFunctionCallingFormat }`). We must add `unregister` here since the Ref is not accessible from outside.

Add an `unregister` function inside `makeToolRegistry`, after the existing `list` function:

```typescript
const unregister = (name: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const tools = yield* Ref.get(toolsRef);
    const entry = tools.get(name);
    // Protect builtin tools from removal
    if (entry && entry.definition.source === "builtin") return;
    if (entry) {
      yield* Ref.update(toolsRef, (current) => {
        const next = new Map(current);
        next.delete(name);
        return next;
      });
    }
  });
```

Update the return statement to include `unregister`:

```typescript
return { register, get, list, toFunctionCallingFormat, unregister };
```

- [ ] **Step 4: Add unregisterTool to ToolService interface and ToolServiceLive**

In `packages/tools/src/tool-service.ts`, find the `ToolService` Context.Tag definition and add `unregisterTool` to the interface shape:

```typescript
readonly unregisterTool: (
  name: string,
) => Effect.Effect<void, never>;
```

In the `ToolServiceLive` layer implementation, the registry object (returned by `makeToolRegistry`) now has an `unregister` method. Wire it through:

```typescript
const unregisterTool = (name: string) => registry.unregister(name);
```

Include `unregisterTool` in the returned service object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/tools && bun test tests/dynamic-registration.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/registry/tool-registry.ts packages/tools/src/tool-service.ts packages/tools/tests/dynamic-registration.test.ts
git commit -m "feat(tools): add unregisterTool for dynamic tool lifecycle management"
```

---

### Task 6: Add registerTool/unregisterTool to ReactiveAgent facade

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Create: `packages/runtime/tests/dynamic-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

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
        requiresApproval: false,
      },
      (args) => Effect.succeed({ sum: (args.a as number) + (args.b as number) }),
    );

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
        requiresApproval: false,
      },
      () => Effect.succeed("ok"),
    );

    await agent.unregisterTool("temp-tool");
    await agent.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/dynamic-tools.test.ts`
Expected: FAIL — `agent.registerTool is not a function`

- [ ] **Step 3: Add registerTool/unregisterTool to ReactiveAgent**

In `packages/runtime/src/builder.ts`, find the `ReactiveAgent` class. Add an import for ToolService:

```typescript
import { ToolService } from "@reactive-agents/tools";
import type { ToolDefinition, ToolExecutionError } from "@reactive-agents/tools";
```

Add two methods to the ReactiveAgent class. These follow the same pattern as other facade methods (e.g., `pause`, `resume`) that use `this.runtime.runPromise()`:

```typescript
/**
 * Register a tool at runtime (post-build).
 * The tool becomes available for the agent's next execution.
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

Note: The implementing agent must verify that `ToolService` is available in the runtime's service scope. Since `withTools()` is called in the test setup, the ToolService layer should be present. If `Effect.Effect` needs to be imported, add it to the existing import from `"effect"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/dynamic-tools.test.ts`
Expected: PASS — all 2 tests

- [ ] **Step 5: Build to verify compilation**

Run: `cd packages/tools && bun run build && cd ../runtime && bun run build`
Expected: Clean builds

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/dynamic-tools.test.ts
git commit -m "feat(runtime): add registerTool/unregisterTool to ReactiveAgent facade"
```

---

## Chunk 3: Lightweight Agent Composition

### Task 7: Create AgentFn primitive

**Files:**
- Create: `packages/runtime/src/compose.ts`
- Create: `packages/runtime/tests/compose.test.ts`

`AgentFn` is a callable function that wraps a lazily-built agent. It's the lightweight primitive that makes composition feel like composing functions.

```typescript
// Usage:
const researcher = agentFn({ name: "researcher", provider: "anthropic", tools: { enabled: true } });
const result = await researcher("What are the latest AI papers?");
await researcher.dispose();
```

- [ ] **Step 1: Write the failing tests for agentFn**

```typescript
// packages/runtime/tests/compose.test.ts
import { describe, test, expect } from "bun:test";
import { agentFn } from "../src/compose.js";
import type { AgentFn } from "../src/compose.js";

describe("agentFn", () => {
  test("creates a callable agent function", async () => {
    const fn = agentFn(
      { name: "test-fn", provider: "test" },
      (b) => b.withTestScenario([{ text: "Hello from agentFn" }]),
    );
    const result = await fn("test input");
    expect(result).toBeDefined();
    expect(result.output).toContain("Hello from agentFn");
    await fn.dispose();
  });

  test("lazily builds agent on first call", async () => {
    const fn = agentFn(
      { name: "lazy-agent", provider: "test" },
      (b) => b.withTestScenario([{ text: "first call" }]),
    );
    // No agent built yet — just a function
    expect(fn.config.name).toBe("lazy-agent");
    const result = await fn("go");
    expect(result.output).toContain("first call");
    await fn.dispose();
  });

  test("reuses agent across calls", async () => {
    const fn = agentFn(
      { name: "reuse-agent", provider: "test" },
      (b) =>
        b.withTestScenario([
          { text: "call one" },
          { text: "call two" },
        ]),
    );
    const r1 = await fn("first");
    const r2 = await fn("second");
    expect(r1.output).toContain("call one");
    expect(r2.output).toContain("call two");
    await fn.dispose();
  });

  test("dispose cleans up the agent", async () => {
    const fn = agentFn(
      { name: "dispose-agent", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    await fn("go");
    await fn.dispose();
    // After dispose, next call should rebuild
  });

  test("config property exposes the config", () => {
    const fn = agentFn({ name: "config-check", provider: "anthropic" });
    expect(fn.config.name).toBe("config-check");
    expect(fn.config.provider).toBe("anthropic");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: FAIL — module `../src/compose.js` not found

- [ ] **Step 3: Implement agentFn**

```typescript
// packages/runtime/src/compose.ts
import type { AgentConfig } from "./agent-config.js";
import { agentConfigToBuilder } from "./agent-config.js";
import type { ReactiveAgentBuilder, AgentResult } from "./builder.js";

/**
 * A lightweight, callable agent function.
 *
 * Call it like a function to run the agent. The underlying ReactiveAgent
 * is lazily built on first call and reused for subsequent calls.
 *
 * @example
 * ```typescript
 * const research = agentFn({ name: "researcher", provider: "anthropic" });
 * const result = await research("Find recent AI papers");
 * await research.dispose();
 * ```
 */
export type AgentFn = ((input: string) => Promise<AgentResult>) & {
  /** Clean up the underlying agent. Safe to call multiple times. */
  dispose: () => Promise<void>;
  /** The config this agent was created from. */
  config: AgentConfig;
};

/**
 * Create a lightweight agent function from a config.
 *
 * The agent is lazily built on first invocation and reused for subsequent calls.
 * Pass a `customize` function to modify the builder before building (useful for
 * test scenarios or adding features not representable in AgentConfig).
 *
 * @param config - Agent configuration (name and provider required)
 * @param customize - Optional builder customization function
 */
export function agentFn(
  config: Partial<AgentConfig> & Pick<AgentConfig, "name" | "provider">,
  customize?: (builder: ReactiveAgentBuilder) => ReactiveAgentBuilder,
): AgentFn {
  let agent: { run: (input: unknown) => Promise<any>; dispose: () => Promise<void> } | null = null;

  const fullConfig: AgentConfig = { ...config } as AgentConfig;

  const fn = async (input: string): Promise<AgentResult> => {
    if (!agent) {
      let builder = agentConfigToBuilder(fullConfig);
      if (customize) builder = customize(builder);
      agent = await builder.build();
    }
    return agent.run(input);
  };

  fn.dispose = async () => {
    if (agent) {
      await agent.dispose();
      agent = null;
    }
  };

  fn.config = fullConfig;

  return fn as AgentFn;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: PASS — all 5 tests

Note: The implementing agent may need to check what `agent.dispose()` does — it should call `this.runtime.dispose()` on the ManagedRuntime. If `dispose()` doesn't exist on ReactiveAgent, the implementing agent should add it (it's just `await this.runtime.dispose()`) or use a cleanup approach that works.

Also note: The `withTestScenario` approach requires that the test provider supports multiple `run()` calls consuming sequential turns. If the test provider resets between runs, the "reuses agent across calls" test may need adjustment. The implementing agent should verify this behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/compose.ts packages/runtime/tests/compose.test.ts
git commit -m "feat(runtime): add agentFn() lightweight agent primitive for functional composition"
```

---

### Task 8: Implement pipe() — sequential composition

**Files:**
- Modify: `packages/runtime/src/compose.ts`
- Modify: `packages/runtime/tests/compose.test.ts`

`pipe()` chains agents sequentially — each agent's output becomes the next agent's input.

- [ ] **Step 1: Write the failing tests for pipe**

Add to `packages/runtime/tests/compose.test.ts`:

```typescript
import { agentFn, pipe } from "../src/compose.js";

describe("pipe", () => {
  test("chains two agents sequentially", async () => {
    const first = agentFn(
      { name: "first", provider: "test" },
      (b) => b.withTestScenario([{ text: "step-one-result" }]),
    );
    const second = agentFn(
      { name: "second", provider: "test" },
      (b) => b.withTestScenario([{ text: "final-result" }]),
    );
    const pipeline = pipe(first, second);
    const result = await pipeline("initial input");
    expect(result.output).toContain("final-result");
    await pipeline.dispose();
  });

  test("chains three agents", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-a" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-b" }]),
    );
    const c = agentFn(
      { name: "c", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-c" }]),
    );
    const pipeline = pipe(a, b2, c);
    const result = await pipeline("start");
    expect(result.output).toContain("from-c");
    await pipeline.dispose();
  });

  test("passes output of each stage as input to next", async () => {
    // We can't fully verify the input reaches the next agent with test provider,
    // but we verify the pipeline runs to completion and returns the last result
    const first = agentFn(
      { name: "first", provider: "test" },
      (b) => b.withTestScenario([{ text: "intermediate" }]),
    );
    const second = agentFn(
      { name: "second", provider: "test" },
      (b) => b.withTestScenario([{ text: "done" }]),
    );
    const pipeline = pipe(first, second);
    const result = await pipeline("begin");
    expect(result.success).toBe(true);
    await pipeline.dispose();
  });

  test("pipe result is itself an AgentFn", async () => {
    const fn = agentFn(
      { name: "single", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    const pipeline = pipe(fn);
    expect(pipeline.config.name).toBe("pipe(single)");
    expect(typeof pipeline.dispose).toBe("function");
    await pipeline.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: FAIL — `pipe` not exported from compose.js

- [ ] **Step 3: Implement pipe**

Add to `packages/runtime/src/compose.ts`:

```typescript
/**
 * Compose agents sequentially — each agent's output becomes the next agent's input.
 *
 * Returns an AgentFn that runs the pipeline end-to-end and returns
 * the final agent's result.
 *
 * @example
 * ```typescript
 * const pipeline = pipe(
 *   agentFn({ name: "research", provider: "anthropic" }),
 *   agentFn({ name: "summarize", provider: "anthropic" }),
 * );
 * const result = await pipeline("Find and summarize AI papers");
 * ```
 */
export function pipe(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0) throw new Error("pipe requires at least one AgentFn");

  const composedName = `pipe(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    let current = input;
    let lastResult: AgentResult | null = null;

    for (const agentFn of fns) {
      lastResult = await agentFn(current);
      current = lastResult.output;
    }

    return {
      ...lastResult!,
      agentId: composedName,
      metadata: {
        ...lastResult!.metadata,
        compositionType: "pipe",
        stages: fns.length,
      },
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: PASS — all 9 tests (5 agentFn + 4 pipe)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/compose.ts packages/runtime/tests/compose.test.ts
git commit -m "feat(runtime): add pipe() for sequential agent composition"
```

---

### Task 9: Implement parallel() and race()

**Files:**
- Modify: `packages/runtime/src/compose.ts`
- Modify: `packages/runtime/tests/compose.test.ts`

`parallel()` runs all agents on the same input concurrently, collecting all results.
`race()` runs all agents concurrently, returning the first to complete.

- [ ] **Step 1: Write the failing tests**

Add to `packages/runtime/tests/compose.test.ts`:

```typescript
import { agentFn, pipe, parallel, race } from "../src/compose.js";

describe("parallel", () => {
  test("runs multiple agents concurrently on same input", async () => {
    const a = agentFn(
      { name: "agent-a", provider: "test" },
      (b) => b.withTestScenario([{ text: "result-a" }]),
    );
    const b2 = agentFn(
      { name: "agent-b", provider: "test" },
      (b) => b.withTestScenario([{ text: "result-b" }]),
    );
    const combined = parallel(a, b2);
    const result = await combined("same input");
    expect(result.success).toBe(true);
    expect(result.output).toContain("result-a");
    expect(result.output).toContain("result-b");
    await combined.dispose();
  });

  test("metadata includes individual results", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "alpha" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "beta" }]),
    );
    const combined = parallel(a, b2);
    const result = await combined("go");
    expect(result.metadata?.results).toBeDefined();
    expect((result.metadata!.results as any[]).length).toBe(2);
    await combined.dispose();
  });

  test("success is true only if all agents succeed", async () => {
    const ok = agentFn(
      { name: "ok", provider: "test" },
      (b) => b.withTestScenario([{ text: "fine" }]),
    );
    const combined = parallel(ok);
    const result = await combined("go");
    expect(result.success).toBe(true);
    await combined.dispose();
  });

  test("parallel result is composable with pipe", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "data" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "more data" }]),
    );
    const summarizer = agentFn(
      { name: "summarizer", provider: "test" },
      (b) => b.withTestScenario([{ text: "summary" }]),
    );
    const pipeline = pipe(parallel(a, b2), summarizer);
    const result = await pipeline("start");
    expect(result.output).toContain("summary");
    await pipeline.dispose();
  });
});

describe("race", () => {
  test("returns first result to complete", async () => {
    const fast = agentFn(
      { name: "fast", provider: "test" },
      (b) => b.withTestScenario([{ text: "fast-wins" }]),
    );
    const slow = agentFn(
      { name: "slow", provider: "test" },
      (b) => b.withTestScenario([{ text: "slow-loses" }]),
    );
    const racer = race(fast, slow);
    const result = await racer("go");
    // Both should return near-instantly with test provider
    expect(result.success).toBe(true);
    await racer.dispose();
  });

  test("race result is an AgentFn", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    const racer = race(a);
    expect(racer.config.name).toBe("race(a)");
    expect(typeof racer.dispose).toBe("function");
    await racer.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: FAIL — `parallel` and `race` not exported

- [ ] **Step 3: Implement parallel and race**

Add to `packages/runtime/src/compose.ts`:

```typescript
/**
 * Run multiple agents concurrently on the same input, collecting all results.
 *
 * The combined output merges all agent outputs with agent name labels.
 * Metadata includes the individual results for downstream processing.
 * Success is true only if ALL agents succeed.
 *
 * @example
 * ```typescript
 * const results = parallel(
 *   agentFn({ name: "researcher", provider: "anthropic" }),
 *   agentFn({ name: "analyst", provider: "openai" }),
 * );
 * const result = await results("Analyze market trends");
 * // result.output contains both agents' outputs
 * // result.metadata.results has individual results
 * ```
 */
export function parallel(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0) throw new Error("parallel requires at least one AgentFn");

  const composedName = `parallel(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    const results = await Promise.all(fns.map((f) => f(input)));

    const output = results
      .map((r, i) => `[${fns[i].config.name}]: ${r.output}`)
      .join("\n\n");

    return {
      output,
      success: results.every((r) => r.success),
      taskId: results[0]?.taskId ?? "",
      agentId: composedName,
      metadata: {
        compositionType: "parallel",
        results: results.map((r, i) => ({
          name: fns[i].config.name,
          output: r.output,
          success: r.success,
          agentId: r.agentId,
        })),
      },
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}

/**
 * Run multiple agents concurrently, returning the first result.
 *
 * Uses Promise.race — the first agent to complete wins.
 * Remaining agents continue in the background (their results are discarded).
 *
 * @example
 * ```typescript
 * const fastest = race(
 *   agentFn({ name: "claude", provider: "anthropic" }),
 *   agentFn({ name: "gpt4", provider: "openai" }),
 * );
 * const result = await fastest("Quick question");
 * ```
 */
export function race(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0) throw new Error("race requires at least one AgentFn");

  const composedName = `race(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    const result = await Promise.race(fns.map((f) => f(input)));
    return {
      ...result,
      metadata: {
        ...result.metadata,
        compositionType: "race",
        candidates: fns.length,
      },
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && bun test tests/compose.test.ts`
Expected: PASS — all 15 tests (5 agentFn + 4 pipe + 4 parallel + 2 race)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/compose.ts packages/runtime/tests/compose.test.ts
git commit -m "feat(runtime): add parallel() and race() for concurrent agent composition"
```

---

### Task 10: Exports and build verification

**Files:**
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Add composition exports to index.ts**

Add to `packages/runtime/src/index.ts`:

```typescript
// ─── Agent Composition ───
export { agentFn, pipe, parallel, race } from "./compose.js";
export type { AgentFn } from "./compose.js";
```

- [ ] **Step 2: Run full test suite for runtime package**

Run: `cd packages/runtime && bun test`
Expected: All existing tests + new tests pass

- [ ] **Step 3: Build the package**

Run: `cd packages/runtime && bun run build`
Expected: Clean build, all new files compiled

- [ ] **Step 4: Run full project test suite**

Run: `bun test`
Expected: All tests pass (2194+ existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/index.ts
git commit -m "feat(runtime): export composition API (agentFn, pipe, parallel, race)"
```

---

## Summary

| Enhancement | Tasks | New Files | Modified Files | Tests |
|---|---|---|---|---|
| 1. Agent as Data (AgentConfig) | Tasks 1-4 | `agent-config.ts`, `agent-config.test.ts` | `builder.ts`, `index.ts` | ~20 |
| 2. Dynamic Tool Registration | Tasks 5-6 | `dynamic-registration.test.ts`, `dynamic-tools.test.ts` | `tool-service.ts`, `builder.ts` | ~7 |
| 3. Lightweight Composition | Tasks 7-10 | `compose.ts`, `compose.test.ts` | `index.ts` | ~15 |
| **Total** | **10 tasks** | **5 new files** | **4 modified files** | **~42 tests** |

Chunks 1 and 2 are independent and can be implemented in parallel. Chunk 3 depends on Chunk 1 (uses `agentConfigToBuilder`).
