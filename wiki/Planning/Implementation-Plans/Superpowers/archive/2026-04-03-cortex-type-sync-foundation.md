# Cortex Type Sync Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `buildCortexAgent()`'s manual builder chain with `agentConfigToBuilder()` so that any new framework builder method backed by `AgentConfigSchema` automatically flows through Cortex without manual wiring.

**Architecture:** Map Cortex UI params → `AgentConfig` (framework schema) → `agentConfigToBuilder()` → apply a thin Cortex overlay for the ~9 fields that have no `AgentConfig` representation (skills, agentTools, metaTools, dynamicSubAgents, taskContext, minIterations, progressCheckpoint, verificationStep, contextSynthesis). `buildCortexAgent.ts` becomes the sole owner of this overlay; runner-service and gateway-process-manager already delegate to it.

**Tech Stack:** TypeScript, Effect-TS `Schema`, `@reactive-agents/runtime` (AgentConfigSchema, agentConfigToBuilder), Bun test

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/cortex/server/services/cortex-to-agent-config.ts` | Pure mapping: `BuildCortexAgentParams` → `AgentConfig` |
| Modify | `apps/cortex/server/services/build-cortex-agent.ts` | Replace builder chain with `agentConfigToBuilder()` + overlay applicator |
| Create | `apps/cortex/server/tests/cortex-to-agent-config.test.ts` | Round-trip and field-coverage tests |

---

### Task 1: Create `cortex-to-agent-config.ts` — param mapper

**Files:**
- Create: `apps/cortex/server/services/cortex-to-agent-config.ts`
- Test: `apps/cortex/server/tests/cortex-to-agent-config.test.ts`

**Background:** `AgentConfigSchema` lives in `@reactive-agents/runtime`. The Cortex params it can cover: `name`, `provider`, `model`, `temperature`, `maxTokens`, `systemPrompt`, `strategy` (→ `reasoning.defaultStrategy`), `strategySwitching` (→ `reasoning.enableStrategySwitching`), `maxIterations` (→ `execution.maxIterations`), `timeout` (→ `execution.timeoutMs`), `retryPolicy` (→ `execution.retryPolicy`), `cacheTimeout` (→ `execution.cacheTimeoutMs`), `tools` (→ `tools.allowedTools`), `guardrails` (threshold numbers → booleans), `memory` tiers (→ `memory.tier`), `persona` (shape-maps), `observabilityVerbosity` + logging (→ `observability` + `logging`), `fallbacks` (→ `fallbacks` minus `enabled`), `mcpConfigs` (→ `mcpServers`), `healthCheck` (→ `features.healthCheck`).

**Fields with NO `AgentConfig` equivalent (handled as overlays in Task 2):** `minIterations`, `progressCheckpoint`, `verificationStep`, `taskContext`, `skills`, `agentTools`, `dynamicSubAgents`, `metaTools`, `contextSynthesis`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/cortex/server/tests/cortex-to-agent-config.test.ts
import { describe, expect, it } from "bun:test";
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
    expect(config.guardrails?.pii).toBe(false);   // threshold = 0 → false
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
    expect(config.mcpServers?.[0].name).toBe("my-server");
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts 2>&1 | tail -20
```

Expected: FAIL — `cortex-to-agent-config.js` not found.

- [ ] **Step 3: Implement `cortex-to-agent-config.ts`**

```typescript
// apps/cortex/server/services/cortex-to-agent-config.ts
/**
 * Maps BuildCortexAgentParams → AgentConfig (framework schema).
 *
 * Covers all fields that have a direct AgentConfig representation.
 * Cortex-specific fields with no AgentConfig equivalent (skills, agentTools,
 * metaTools, dynamicSubAgents, taskContext, minIterations, progressCheckpoint,
 * verificationStep, contextSynthesis) are handled as overlays in build-cortex-agent.ts.
 */
import type { AgentConfig } from "@reactive-agents/runtime";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";

export function cortexParamsToAgentConfig(
  params: Omit<BuildCortexAgentParams, "agentName">,
  nameFallback?: string,
): AgentConfig {
  const name = (params as any).agentName?.trim() || nameFallback || `cortex-desk-${Date.now()}`;
  const provider = (params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test") as AgentConfig["provider"];

  const config: AgentConfig = { name, provider };

  // ── Model params ─────────────────────────────────────────────────────────
  const modelStr = params.model?.trim();
  if (modelStr) config.model = modelStr;
  if (params.temperature != null) config.temperature = params.temperature;
  if (params.maxTokens) config.maxTokens = params.maxTokens;

  // ── System prompt ────────────────────────────────────────────────────────
  if (params.systemPrompt?.trim()) config.systemPrompt = params.systemPrompt.trim();

  // ── Reasoning ────────────────────────────────────────────────────────────
  const reasoning: NonNullable<AgentConfig["reasoning"]> = {};
  if (params.strategy) {
    reasoning.defaultStrategy = params.strategy as NonNullable<AgentConfig["reasoning"]>["defaultStrategy"];
  }
  if (params.strategySwitching === true) reasoning.enableStrategySwitching = true;
  if (Object.keys(reasoning).length > 0) config.reasoning = reasoning;

  // ── Execution ────────────────────────────────────────────────────────────
  const execution: NonNullable<AgentConfig["execution"]> = {};
  if (params.maxIterations && params.maxIterations > 0) execution.maxIterations = params.maxIterations;
  if (params.timeout && params.timeout > 0) execution.timeoutMs = params.timeout;
  if (params.cacheTimeout && params.cacheTimeout > 0) execution.cacheTimeoutMs = params.cacheTimeout;
  if (params.retryPolicy?.enabled === true && params.retryPolicy.maxRetries > 0) {
    execution.retryPolicy = {
      maxRetries: params.retryPolicy.maxRetries,
      backoffMs: params.retryPolicy.backoffMs ?? 1000,
    };
  }
  if (Object.keys(execution).length > 0) config.execution = execution;

  // ── Tools allowlist ──────────────────────────────────────────────────────
  // Note: the merged allowedTools (including metaTools and framework tools) are
  // computed in build-cortex-agent.ts and injected via withTools() overlay.
  // Here we just record the user's explicit tool selections for schema alignment.
  if (params.tools && params.tools.length > 0) {
    config.tools = { allowedTools: [...params.tools] };
  }

  // ── Memory tier ──────────────────────────────────────────────────────────
  if (params.memory) {
    const tier: "enhanced" | "standard" =
      params.memory.episodic === true || params.memory.semantic === true
        ? "enhanced"
        : "standard";
    config.memory = { tier };
  }

  // ── Guardrails ───────────────────────────────────────────────────────────
  if (params.guardrails?.enabled === true) {
    config.guardrails = {
      injection:
        params.guardrails.injectionThreshold != null
          ? params.guardrails.injectionThreshold > 0
          : true,
      pii:
        params.guardrails.piiThreshold != null
          ? params.guardrails.piiThreshold > 0
          : true,
      toxicity:
        params.guardrails.toxicityThreshold != null
          ? params.guardrails.toxicityThreshold > 0
          : true,
    };
  }

  // ── Persona ──────────────────────────────────────────────────────────────
  if (params.persona?.enabled === true) {
    const p = params.persona;
    const instructionParts: string[] = [];
    if (p.traits) instructionParts.push(p.traits);
    if (p.responseStyle) instructionParts.push(`Response style: ${p.responseStyle}`);
    config.persona = {
      ...(p.role ? { role: p.role } : {}),
      ...(p.tone ? { tone: p.tone } : {}),
      ...(instructionParts.length > 0 ? { instructions: instructionParts.join("\n") } : {}),
    };
  }

  // ── Observability + logging ──────────────────────────────────────────────
  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    config.observability = {
      verbosity: params.observabilityVerbosity,
      live: true,
    };
    config.logging = {
      level: params.observabilityVerbosity === "verbose" ? "debug" : "info",
      format: "json",
      output: "file",
      filePath: process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log",
    };
  }

  // ── Fallbacks ────────────────────────────────────────────────────────────
  if (params.fallbacks?.enabled === true && params.fallbacks.providers?.length) {
    config.fallbacks = {
      providers: [...params.fallbacks.providers],
      ...(params.fallbacks.errorThreshold != null
        ? { errorThreshold: params.fallbacks.errorThreshold }
        : {}),
    };
  }

  // ── MCP servers ──────────────────────────────────────────────────────────
  if (params.mcpConfigs && params.mcpConfigs.length > 0) {
    config.mcpServers = params.mcpConfigs as AgentConfig["mcpServers"];
  }

  // ── Health check ─────────────────────────────────────────────────────────
  if (params.healthCheck === true) {
    config.features = { ...(config.features ?? {}), healthCheck: true };
  }

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -40
```

Expected: Zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/services/cortex-to-agent-config.ts \
        apps/cortex/server/tests/cortex-to-agent-config.test.ts
git commit -m "feat(cortex): cortexParamsToAgentConfig maps UI params to AgentConfig schema"
```

---

### Task 2: Refactor `build-cortex-agent.ts` to use `agentConfigToBuilder()` + overlays

**Files:**
- Modify: `apps/cortex/server/services/build-cortex-agent.ts`

**Background:** `agentConfigToBuilder()` from `@reactive-agents/runtime` handles everything in `AgentConfig`. After calling it, we apply a thin Cortex overlay for the 9 fields that have no `AgentConfig` representation:
1. `contextSynthesis` — maps to `ReasoningOptions.synthesis` (`"template"→"fast"`, `"llm"→"deep"`, `"auto"→"auto"`)
2. `minIterations` — `builder.withMinIterations(n)`
3. `progressCheckpoint` — `builder.withProgressCheckpoint(n)`
4. `verificationStep` — `builder.withVerificationStep({ mode: "reflect" })`
5. `taskContext` — `builder.withTaskContext(record)`
6. `skills` — `builder.withSkills(config)`
7. `agentTools` — `builder.withAgentTool()` / `builder.withRemoteAgent()`
8. `dynamicSubAgents` — `builder.withDynamicSubAgents()`
9. `metaTools` — `builder.withMetaTools()` + `builder.withTools({ allowedTools: merged })`

Note: `withTools({ allowedTools })` is also an overlay because the merged list includes `metaTools` names and framework tools that aren't in the user's explicit tool selections. The `agentConfigToBuilder()` call will set the raw user tools; we override with the merged list in the overlay.

- [ ] **Step 1: Write the failing test (integration smoke test)**

Add to `apps/cortex/server/tests/cortex-to-agent-config.test.ts`:

```typescript
import { buildCortexAgent } from "../services/build-cortex-agent.js";

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
});
```

- [ ] **Step 2: Run test to verify it fails (or passes with current impl)**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts --filter "buildCortexAgent round-trip" 2>&1 | tail -20
```

Note: These tests may already pass. If so, record that and proceed with the refactor.

- [ ] **Step 3: Refactor `build-cortex-agent.ts`**

Replace the entire content with:

```typescript
/**
 * Shared agent builder for Cortex.
 *
 * Both `runner-service` (ad-hoc POST /api/runs) and `gateway-process-manager`
 * (scheduled/gateway runs) go through this single function so the builder chain
 * is never duplicated.
 *
 * Architecture: cortexParamsToAgentConfig() maps Cortex UI fields → AgentConfig,
 * then agentConfigToBuilder() handles all schema-covered fields. A thin overlay
 * applies the 9 Cortex-specific fields that have no AgentConfig representation.
 */
import { agentConfigToBuilder } from "@reactive-agents/runtime";
import type { ReasoningOptions } from "@reactive-agents/runtime";
import { ensureParentDirForFile } from "./ensure-log-path.js";
import {
  mergeCortexAllowedTools,
  type CortexAgentToolEntry,
  type CortexDynamicSubAgentsConfig,
  type CortexMetaToolsConfig,
  type CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { cortexParamsToAgentConfig } from "./cortex-to-agent-config.js";

export interface BuildCortexAgentParams {
  readonly agentName?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly strategy?: string;
  readonly maxIterations?: number;
  readonly minIterations?: number;
  readonly systemPrompt?: string;
  readonly taskContext?: Record<string, string>;
  readonly healthCheck?: boolean;
  readonly skills?: CortexSkillsConfig;
  readonly mcpConfigs?: import("@reactive-agents/runtime").MCPServerConfig[];
  readonly tools?: string[];
  readonly agentTools?: CortexAgentToolEntry[];
  readonly dynamicSubAgents?: CortexDynamicSubAgentsConfig;
  readonly metaTools?: CortexMetaToolsConfig;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly cacheTimeout?: number;
  readonly progressCheckpoint?: number;
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly verificationStep?: string;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  readonly strategySwitching?: boolean;
  readonly memory?: {
    readonly working?: boolean;
    readonly episodic?: boolean;
    readonly semantic?: boolean;
  };
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  readonly guardrails?: {
    readonly enabled?: boolean;
    readonly injectionThreshold?: number;
    readonly piiThreshold?: number;
    readonly toxicityThreshold?: number;
  };
  readonly persona?: {
    readonly enabled?: boolean;
    readonly role?: string;
    readonly tone?: string;
    readonly traits?: string;
    readonly responseStyle?: string;
  };
}

/**
 * Build a configured ReactiveAgent from Cortex params.
 *
 * Step 1: cortexParamsToAgentConfig() → AgentConfig (schema-validated)
 * Step 2: agentConfigToBuilder()     → ReactiveAgentBuilder (framework handles all AgentConfig fields)
 * Step 3: Cortex overlay             → applies 9 fields not covered by AgentConfig
 */
export async function buildCortexAgent(
  params: BuildCortexAgentParams,
  agentNameFallback?: string,
): ReturnType<ReturnType<typeof import("@reactive-agents/runtime").ReactiveAgents.create>["build"]> {
  // ── Step 1: Map to AgentConfig ────────────────────────────────────────────
  const agentConfig = cortexParamsToAgentConfig(
    params as any,
    agentNameFallback,
  );

  // ── Step 2: Framework builder via agentConfigToBuilder() ─────────────────
  let b = await agentConfigToBuilder(agentConfig);

  // Ensure log file parent dir exists when observability is enabled
  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    const agentLogFile = process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log";
    ensureParentDirForFile(agentLogFile);
  }

  // ── Step 3: Cortex overlay (fields not in AgentConfig) ───────────────────

  // contextSynthesis → ReasoningOptions.synthesis (not in AgentConfig)
  if (params.contextSynthesis && params.contextSynthesis !== "none") {
    const synthesisMap: Record<string, string> = { auto: "auto", template: "fast", llm: "deep" };
    const synthesis = synthesisMap[params.contextSynthesis] ?? "auto";
    // We need to override reasoning with synthesis added. withReasoning merges, so this is safe.
    const ro: { synthesis?: string } = { synthesis };
    b = b.withReasoning(ro as ReasoningOptions);
  }

  // MCP servers — agentConfigToBuilder() handles mcpServers via withMCP(array).
  // Individual sub-agents (agentTools) need per-entry calls which AgentConfig doesn't model.
  for (const at of params.agentTools ?? []) {
    if (at.kind === "remote") {
      b = b.withRemoteAgent(at.toolName, at.remoteUrl);
    } else {
      b = b.withAgentTool(at.toolName, {
        name: at.agent.name,
        ...(at.agent.description ? { description: at.agent.description } : {}),
        ...(at.agent.provider ? { provider: at.agent.provider } : {}),
        ...(at.agent.model ? { model: at.agent.model } : {}),
        ...(at.agent.tools && at.agent.tools.length > 0 ? { tools: [...at.agent.tools] } : {}),
        ...(at.agent.maxIterations ? { maxIterations: at.agent.maxIterations } : {}),
        ...(at.agent.systemPrompt ? { systemPrompt: at.agent.systemPrompt } : {}),
      });
    }
  }

  if (params.dynamicSubAgents?.enabled) {
    b = b.withDynamicSubAgents(
      params.dynamicSubAgents.maxIterations
        ? { maxIterations: params.dynamicSubAgents.maxIterations }
        : undefined,
    );
  }

  // Merged allowedTools list — replaces the raw user tools set by agentConfigToBuilder()
  // because it must include framework tools, metaTool names, and agentTool names.
  const allowExtras = {
    spawnAgent: params.dynamicSubAgents?.enabled === true,
    agentToolNames: params.agentTools?.map((t) => t.toolName) ?? [],
  };
  const userTools = params.tools ?? [];
  const mergedAllowed = mergeCortexAllowedTools(userTools, params.metaTools, allowExtras);
  const needsToolLayer =
    (params.mcpConfigs?.length ?? 0) > 0 ||
    (params.agentTools && params.agentTools.length > 0) ||
    params.dynamicSubAgents?.enabled === true ||
    (params.tools && params.tools.length > 0) ||
    params.metaTools?.enabled === true;
  if (needsToolLayer) {
    b = b.withTools({ allowedTools: mergedAllowed });
  }

  // Task context
  const tc = params.taskContext;
  if (tc && Object.keys(tc).length > 0) b = b.withTaskContext(tc);

  // Skills
  if (params.skills?.paths?.length) {
    b = b.withSkills({
      paths: [...params.skills.paths],
      ...(params.skills.evolution ? { evolution: { ...params.skills.evolution } } : {}),
    });
  }

  // Execution quality controls
  if (params.minIterations && params.minIterations > 0) b = b.withMinIterations(params.minIterations);
  if (params.progressCheckpoint && params.progressCheckpoint > 0) {
    b = b.withProgressCheckpoint(params.progressCheckpoint);
  }
  if (params.verificationStep === "reflect") b = b.withVerificationStep({ mode: "reflect" });

  // Meta tools (after tools layer is established)
  if (params.metaTools?.enabled) {
    b = b.withMetaTools({
      brief: params.metaTools.brief ?? false,
      find: params.metaTools.find ?? false,
      pulse: params.metaTools.pulse ?? false,
      recall: params.metaTools.recall ?? false,
      harnessSkill: params.metaTools.harnessSkill ?? false,
    });
  }

  return b.build();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -40
```

Expected: Zero errors. If there are errors in the `ReturnType<...>` of `buildCortexAgent`, simplify the return type annotation to `Promise<any>` as a stopgap — the function's behavior is what matters, not the complex inferred type.

- [ ] **Step 6: Run full cortex test suite**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex 2>&1 | tail -30
```

Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/services/build-cortex-agent.ts \
        apps/cortex/server/tests/cortex-to-agent-config.test.ts
git commit -m "refactor(cortex): build-cortex-agent uses agentConfigToBuilder() + thin overlay"
```

---

### Task 3: Validate the full pipeline end-to-end

**Files:**
- Test: `apps/cortex/server/tests/cortex-to-agent-config.test.ts` (add schema validation tests)

The mapping function should produce objects that pass `AgentConfigSchema` validation. This catches schema drift early — if framework adds a required field or changes a type, tests fail here before Cortex ships broken agents.

- [ ] **Step 1: Add schema validation test**

Add to `apps/cortex/server/tests/cortex-to-agent-config.test.ts`:

```typescript
import { Schema } from "effect";
import { AgentConfigSchema } from "@reactive-agents/runtime";

describe("cortexParamsToAgentConfig schema validation", () => {
  it("produces a valid AgentConfig for maximal params", () => {
    const config = cortexParamsToAgentConfig({
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
    }, "maximal-test-agent");

    // Schema validation — throws if any field violates AgentConfigSchema
    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)(config)).not.toThrow();
  });

  it("produces a valid AgentConfig for minimal params", () => {
    const config = cortexParamsToAgentConfig({ provider: "test" }, "minimal-test");
    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)(config)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts --filter "schema validation" 2>&1 | tail -20
```

Expected: FAIL — `AgentConfigSchema` not imported yet in test.

- [ ] **Step 3: Add import to test file**

At the top of `apps/cortex/server/tests/cortex-to-agent-config.test.ts`, add:

```typescript
import { Schema } from "effect";
import { AgentConfigSchema } from "@reactive-agents/runtime";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/cortex-to-agent-config.test.ts 2>&1 | tail -20
```

Expected: All tests PASS including schema validation.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test 2>&1 | tail -15
```

Expected: All 3,036+ tests pass (same or more), zero failures.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/tests/cortex-to-agent-config.test.ts
git commit -m "test(cortex): AgentConfig schema validation guards against type drift"
```

---

## Self-Review

**Spec coverage:**
- ✅ `cortexParamsToAgentConfig()` mapping function created
- ✅ All AgentConfig-covered fields mapped (name, provider, model, temperature, maxTokens, systemPrompt, strategy, strategySwitching, maxIterations, timeout, cacheTimeout, retryPolicy, tools, memory tier, guardrails, persona, observability, logging, fallbacks, mcpConfigs, healthCheck)
- ✅ 9 Cortex overlay fields handled: contextSynthesis, minIterations, progressCheckpoint, verificationStep, taskContext, skills, agentTools, dynamicSubAgents, metaTools
- ✅ Schema validation test catches future drift
- ✅ No functional regression: runner-service.ts and gateway-process-manager.ts already delegate to `buildCortexAgent()`
- ✅ `normalizeCortexAgentConfig()` and `runs.ts` unchanged — no blast radius outside the service layer

**Placeholder scan:** None.

**Type consistency:**
- `cortexParamsToAgentConfig` takes `params` typed as `BuildCortexAgentParams` (minus agentName, handled separately) — consistent through all tasks
- Return type is `AgentConfig` which is `Schema.Schema.Type<typeof AgentConfigSchema>` — consistent with schema validation test
- `agentConfigToBuilder()` signature is `async (config: AgentConfig) => Promise<ReactiveAgentBuilder>` — consistent
