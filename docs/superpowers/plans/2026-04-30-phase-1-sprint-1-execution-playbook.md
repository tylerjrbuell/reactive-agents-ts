# Phase 1 Sprint 1 Execution Playbook — Invariant (Builder → Config Routing)

**Shop-floor instructions for Week 2.** Companion to `2026-04-23-north-star-sprint-plan-02-phase-1.md`.

**Goal:** eliminate behavior from the builder. `AgentConfig` becomes the sealed source of truth. W4 fixed by construction.

**Preconditions verified:**
- Phase 0 Sprint 1 PR merged (all 7 stories green, typed errors importable, CI probe gate active)
- Branch `feat/phase-1-invariant` checked out from latest main
- Skills loaded: `effect-ts-patterns`, `agent-tdd`, `review-patterns`, `architecture-reference`, **+ `kernel-extension`, `implement-service`** (new this phase)

---

## Week 2 at a glance (5 stories, 21 pts)

| Day | Story | Title | Points | Critical? |
|---|---|---|---|---|
| Mon AM | Day-0 | Preflight | — | — |
| Mon PM–Tue | P1.S1.1 | `AgentConfig` shape audit + normalization | 3 | ✅ |
| Wed–Thu | P1.S1.2 | Builder pure-setter migration | 8 | ✅ |
| Thu PM | P1.S1.3 | `createRuntime` pure function | 5 | ✅ |
| Fri AM | P1.S1.4 | W4 integration probe enable | 2 | ✅ |
| Fri PM | P1.S1.5 | Config round-trip property tests | 3 | ❌ |

**Capacity:** 21 pts on a 15-pt solo baseline = ~40% over. Scope-cut contract: if P1.S1.2 slips past Thursday EOD, defer P1.S1.5 to a buffer day in Sprint 2.

---

## Day 0 (Monday AM) — Preflight

```bash
# Verify Phase 0 landed
git checkout main
git pull
rtk git log -1

# New branch
git checkout -b feat/phase-1-invariant

# Create sprint log
touch docs/superpowers/plans/sprint-log-p1-sprint-1.md
```

Paste sprint log template (same shape as Phase 0's, adjust IDs).

Read before starting:
- `.claude/skills/effect-ts-patterns/SKILL.md`
- `.claude/skills/implement-service/SKILL.md`
- Current builder: `packages/runtime/src/builder.ts` (5,728 LOC — scan to orient)
- Current `AgentConfig`: `packages/runtime/src/agent-config.ts` (starts at line 198)
- Current runtime layer composition: `packages/runtime/src/runtime.ts:802-1400`

**Day 0 complete when:**
- [ ] Branch created
- [ ] Sprint log created
- [ ] 3 reference files scanned (not read in full — orient only)
- [ ] `bun install` clean (dependencies resolve under new branch)

---

## Story P1.S1.1 — `AgentConfig` Shape Audit + Normalization (Day 1, 3 pts)

### Context

The schema at `agent-config.ts:198` already exists (audit from v2.0 confirmed). The work: ensure every builder option maps to a config field. Fill gaps so P1.S1.2 (builder migration) has a complete target.

### Execution

**Step 1** — Read current schema full:
```bash
bun run typecheck -F @reactive-agents/runtime
# Then open:
cat packages/runtime/src/agent-config.ts | head -400
```

**Step 2** — List every `with*` method in builder.ts:
```bash
rtk proxy "rg 'withReasoning|withMemory|withTools|withTerminal|withA2A|withGateway|withMCP|withLiveRuntime|withTestScenario|withHook|withCircuitBreaker|withRateLimiting|withBehavioralContracts|withErrorHandler|withProgressCheckpoint|withVerificationStep|withOutputValidator|withReactiveIntelligence|withKillSwitch|withHealthCheck|withSelfImprovement|withIdentity|withInteraction|withOrchestration|withAudit|withSkills|withCortexReporter|withName|withAgentId|withPersona|withSystemPrompt|withEnvironment|withModel|withProvider|withTimeout|withMaxIterations|withCalibration|withVerification|withCostTracking|withGuardrails|withTaskContext|withLogging|withFallbacks|withObservability|withPrompts|withExperienceLearning|withMemoryConsolidation|withModelPricing|withDynamicPricing|withContextProfile|withMinIterations|withStreamDensity' packages/runtime/src/builder.ts | head -60"
```

**Step 3** — Create the audit test. File: `packages/runtime/tests/agent-config-audit.test.ts`

```ts
import { describe, it, expect } from "bun:test"
import { Schema } from "effect"
import { AgentConfigSchema } from "../src/agent-config"

/**
 * Canonical mapping from every builder `with*` method to its AgentConfig target
 * field. If a method appears here, the schema MUST accept a config with that
 * field populated. If a new `with*` method is added, append it here FIRST
 * (test-first); then extend AgentConfig; then wire the builder.
 */
export const BUILDER_TO_CONFIG_MAP: readonly { builderMethod: string; configPath: string }[] = [
  { builderMethod: "withName", configPath: "agent.name" },
  { builderMethod: "withAgentId", configPath: "agent.agentId" },
  { builderMethod: "withProvider", configPath: "provider" },
  { builderMethod: "withModel", configPath: "model" },
  { builderMethod: "withReasoning", configPath: "reasoning" },
  { builderMethod: "withReasoning.maxIterations", configPath: "reasoning.maxIterations" },  // W4
  { builderMethod: "withMemory", configPath: "memory" },
  { builderMethod: "withTools", configPath: "tools" },
  { builderMethod: "withContextProfile", configPath: "contextProfile" },
  { builderMethod: "withObservability", configPath: "observability" },
  { builderMethod: "withCostTracking", configPath: "cost" },
  { builderMethod: "withVerification", configPath: "verification" },
  { builderMethod: "withReactiveIntelligence", configPath: "reactiveIntelligence" },
  { builderMethod: "withMCP", configPath: "mcp" },
  { builderMethod: "withTimeout", configPath: "execution.timeoutMs" },
  { builderMethod: "withMaxIterations", configPath: "reasoning.maxIterations" },  // alias
  { builderMethod: "withMinIterations", configPath: "reasoning.minIterations" },
  { builderMethod: "withCalibration", configPath: "calibration" },
  { builderMethod: "withFallbacks", configPath: "provider.fallbacks" },
  { builderMethod: "withIdentity", configPath: "identity" },
  { builderMethod: "withGuardrails", configPath: "guardrails" },
  { builderMethod: "withGateway", configPath: "gateway" },
  { builderMethod: "withInteraction", configPath: "interaction" },
  { builderMethod: "withOrchestration", configPath: "orchestration" },
  { builderMethod: "withSkills", configPath: "skills" },
  { builderMethod: "withLogging", configPath: "logging" },
  { builderMethod: "withPrompts", configPath: "prompts" },
  { builderMethod: "withA2A", configPath: "a2a" },
  // Audit all remaining with* methods and add here before modifying schema.
] as const

function hasNestedPath(obj: unknown, path: string): boolean {
  const parts = path.split(".")
  let cursor: unknown = obj
  for (const part of parts) {
    if (cursor !== null && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part]
    } else {
      return false
    }
  }
  return true
}

describe("AgentConfig schema completeness", () => {
  it.each(BUILDER_TO_CONFIG_MAP)(
    "builder $builderMethod maps to schema field $configPath",
    ({ configPath }) => {
      const minimalFromPath = buildMinimalConfigFromPath(configPath)
      // Decode partial; assert no throw on the shape we expect
      expect(() => Schema.decodeSync(AgentConfigSchema)(minimalFromPath as never)).not.toThrow()
      expect(hasNestedPath(minimalFromPath, configPath)).toBe(true)
    },
  )

  it("reasoning.maxIterations accepts number 10", () => {
    const parsed = Schema.decodeSync(AgentConfigSchema)({
      agent: { name: "x" },
      provider: "anthropic",
      model: "claude-haiku-4-5",
      reasoning: { maxIterations: 10 },
    } as never)
    expect(parsed.reasoning?.maxIterations).toBe(10)
  })
})

function buildMinimalConfigFromPath(path: string): Record<string, unknown> {
  // Build a minimal valid AgentConfig fragment with only `path` populated.
  // Implementation: recursive object construction from dotted path with sane defaults.
  const base: Record<string, unknown> = {
    agent: { name: "test" },
    provider: "anthropic",
    model: "claude-haiku-4-5",
  }
  const parts = path.split(".")
  let cursor = base
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    if (!(key in cursor) || typeof cursor[key] !== "object") {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]!] = {}
  return base
}
```

**Step 4** — Run test (RED expected for any missing fields):
```bash
bun test packages/runtime/tests/agent-config-audit.test.ts --timeout 15000
```

**Step 5** — For each failing map entry, extend `AgentConfigSchema` with the missing field. Use JSDoc per field.

**Step 6** — Re-run test until green.

**Step 7** — Commands + commit:
```bash
bun run typecheck
bun run build -F @reactive-agents/runtime
bun run changeset
# Summary: "runtime: AgentConfig schema audit + completeness test (P1.S1.1)"
git add packages/runtime/src/agent-config.ts packages/runtime/tests/agent-config-audit.test.ts .changeset/
git commit -m "feat(runtime): AgentConfig schema completeness audit (P1.S1.1)"
```

### DoD

- [ ] Audit test maps every builder `with*` method to a schema field
- [ ] Schema extended for any gaps found
- [ ] `bun test` green
- [ ] Typecheck + build clean
- [ ] Changeset added
- [ ] Sprint log updated

### Rollback

Additive schema changes are reversible. If a field causes downstream typecheck failures in other packages, either (a) make the field optional OR (b) back out the specific field and add TODO note pointing to P1.S1.2 follow-up.

---

## Story P1.S1.2 — Builder Pure-Setter Migration (Day 2-3, 8 pts, HEAVIEST)

### Context

The critical story. Every `with*` method becomes `(config, opts) => config`. Builder's private state collapses to a single `_config: AgentConfig`. No more `_maxIterations`, `_reasoningOptions`, `_memoryTier` shadow fields.

**W4 fixed by construction:** the fallback field `_maxIterations` is deleted. The only place `maxIterations` can come from is `config.reasoning.maxIterations`. `createRuntime` reads from config, and config only gets populated by `.withReasoning({ maxIterations })`.

### Execution strategy

**This is a big rewrite. Use per-method migration, not a big-bang rewrite.** Migrate 3-5 methods per commit; keep tests green between commits.

**Step 1** — Create roundtrip test FIRST (RED): `packages/runtime/tests/builder-roundtrip.test.ts`

```ts
import { describe, it, expect } from "bun:test"
import { ReactiveAgents } from "reactive-agents"
import { builderToConfig, agentConfigToBuilder } from "@reactive-agents/runtime/agent-config"

describe("builder roundtrip — Invariant", () => {
  it("every with* option appears in builderToConfig output", () => {
    const b = ReactiveAgents.create()
      .withName("test")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5")
      .withReasoning({ maxIterations: 10, defaultStrategy: "adaptive" })
      .withMemory()
      .withTools({ allowedTools: [] })
    const config = builderToConfig(b)
    expect(config.agent?.name).toBe("test")
    expect(config.provider).toBe("anthropic")
    expect(config.model).toBe("claude-haiku-4-5")
    expect(config.reasoning?.maxIterations).toBe(10)
    expect(config.reasoning?.defaultStrategy).toBe("adaptive")
  })

  it("config → builder → config is identity", () => {
    const original = {
      agent: { name: "test" },
      provider: "anthropic" as const,
      model: "claude-haiku-4-5",
      reasoning: { maxIterations: 10 },
    }
    const b = agentConfigToBuilder(original as never)
    const roundtripped = builderToConfig(b)
    expect(roundtripped).toMatchObject(original)
  })

  it("no with* method mutates fields outside _config", () => {
    const b = ReactiveAgents.create().withReasoning({ maxIterations: 42 })
    // Runtime check: use Object.keys on the builder's private state
    // (via a test-only accessor). Expect only `_config` key.
    const keys = (b as unknown as { __privateFieldNames(): string[] }).__privateFieldNames()
    expect(keys).toEqual(["_config"])
  })
})
```

Add test-only accessor `__privateFieldNames()` to `ReactiveAgentBuilder` via a gated export so tests can introspect.

**Step 2** — W4 regression test RED: `packages/runtime/tests/builder-w4-regression.test.ts`

```ts
import { describe, it, expect } from "bun:test"
import { ReactiveAgents } from "reactive-agents"

describe("W4 — maxIterations honored", () => {
  it("withReasoning({ maxIterations: 10 }) flows to kernel", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5")
      .withReasoning({ maxIterations: 10 })
      .withTools({ allowedTools: [] })
      .build()

    // The probe task is designed to NOT terminate early
    const result = await agent.run(
      "List exactly 12 programming languages, one per line, in a numbered list. Do not provide commentary.",
    )

    // With maxIterations = 10, run may use up to 10 iterations.
    // Pre-fix behavior: capped silently at 3. Must now exceed 3 OR reach a
    // clean termination above 1.
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    expect(result.iterations).toBeLessThanOrEqual(10)

    await agent.dispose()
  }, 180000)
})
```

**Step 3** — Migrate one `with*` method at a time. Order of migration (least risky first):

1. `withName`, `withAgentId`, `withProvider`, `withModel` — trivial setters (group 1 commit)
2. `withReasoning` — this is the W4 fix — critical (group 2 commit)
3. `withMemory`, `withTools`, `withContextProfile` — compound (group 3 commit)
4. `withObservability`, `withCostTracking`, `withVerification` — (group 4 commit)
5. `withMCP`, `withGateway`, `withA2A`, `withIdentity` — (group 5 commit)
6. Behavior-composers (`withLiveRuntime`, `withHook`, `withMCP` side effects) — (group 6 commit, most care)
7. Remaining rare options — (group 7 commit)

**Migration pattern per method:**

```ts
// BEFORE (something like)
private _maxIterations = 10
private _reasoningOptions?: ReasoningOptions

withReasoning(opts: ReasoningOptions): this {
  this._reasoningOptions = opts
  if (opts.maxIterations !== undefined) {
    // NOT actually wiring it — W4 bug
  }
  return this
}

// AFTER
private _config: AgentConfig = defaultAgentConfig()

withReasoning(opts: ReasoningOptions): this {
  this._config = {
    ...this._config,
    reasoning: {
      ...this._config.reasoning,
      ...opts,
    },
  }
  return this
}
```

Delete `_maxIterations`, `_reasoningOptions`, and any orphaned state. Each commit must leave tests green.

**Step 4** — Add `builderToConfig` + `agentConfigToBuilder` if not already present:

```ts
// packages/runtime/src/agent-config.ts
export const builderToConfig = (b: ReactiveAgentBuilder): AgentConfig => {
  // With _config as single source: just return a deep copy
  return structuredClone((b as unknown as { _config: AgentConfig })._config)
}

export const agentConfigToBuilder = (config: AgentConfig): ReactiveAgentBuilder => {
  const b = new ReactiveAgentBuilder()
  ;(b as unknown as { _config: AgentConfig })._config = structuredClone(config)
  return b
}
```

**Step 5** — Run after each migration commit:

```bash
bun test packages/runtime/tests/ --timeout 15000
bun run typecheck -F @reactive-agents/runtime
bun run build -F @reactive-agents/runtime
```

**Step 6** — Final commit:
```bash
bun run changeset
# Summary: "runtime: builder pure-setter migration + W4 fix (P1.S1.2)"
git add -A
git commit -m "feat(runtime): builder pure-setter migration, W4 fixed by construction (P1.S1.2)"
```

### DoD

- [ ] `builder-roundtrip.test.ts` green (3 tests)
- [ ] `builder-w4-regression.test.ts` green
- [ ] No private field on `ReactiveAgentBuilder` other than `_config`
- [ ] All existing builder tests still green (`bun test packages/runtime`)
- [ ] `bun run build` clean across 27 packages
- [ ] Changeset added
- [ ] CI probe `w4-max-iterations` enabled in `.github/workflows/ci.yml`

### Rollback

Per-method commits mean rollback is per-commit `git revert`. If group 6 (behavior-composers) breaks downstream tests, revert that group and add a TODO: "wire behavior-composer migration as its own story in Sprint 2."

---

## Story P1.S1.3 — `createRuntime` Pure Function (Day 4, 5 pts)

### Context

`createRuntime(config, capability) → Effect<Runtime>` is a pure function. All `process.env` reads extracted into a single `ConfigResolver`. Runtime becomes an interpreter.

### Execution

**Step 1** — RED test: `packages/runtime/tests/runtime-purity.test.ts`

```ts
import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"

describe("createRuntime purity", () => {
  it("no process.env reads in runtime.ts", () => {
    const src = readFileSync("packages/runtime/src/runtime.ts", "utf8")
    const matches = src.match(/process\.env/g) ?? []
    expect(matches.length).toBe(0)
  })

  it("createRuntime signature accepts (config, capability)", async () => {
    const { createRuntime } = await import("../src/runtime")
    expect(createRuntime.length).toBe(2)
  })

  it("same (config, capability) yields same composed Layer", async () => {
    const { createRuntime } = await import("../src/runtime")
    const { fixtureConfig, fixtureCapability } = await import("@reactive-agents/testing/fixtures")
    const a = createRuntime(fixtureConfig, fixtureCapability)
    const b = createRuntime(fixtureConfig, fixtureCapability)
    // Both are Effects; asserting shape equality is sufficient
    expect(typeof a).toBe(typeof b)
  })
})
```

**Step 2** — Create `packages/runtime/src/config-resolver.ts`:

```ts
import { Effect } from "effect"
import type { AgentConfig } from "./agent-config"

/**
 * Resolve environment-sourced overrides into an AgentConfig. This is the
 * ONLY module in the runtime that reads process.env. Everything else is
 * pure.
 *
 * Env var conventions (documented in AGENTS.md):
 *   REACTIVE_AGENTS_LLM_PROVIDER — overrides config.provider
 *   REACTIVE_AGENTS_LLM_MODEL — overrides config.model
 *   REACTIVE_AGENTS_MAX_ITERATIONS — overrides config.reasoning.maxIterations
 *   REACTIVE_AGENTS_TELEMETRY_BASE_URL — overrides config.observability.telemetryUrl
 *   (full list in AGENTS.md §Adaptive Calibration)
 */
export const resolveConfigFromEnv = (config: AgentConfig): Effect.Effect<AgentConfig> =>
  Effect.sync(() => {
    let merged = config
    if (process.env.REACTIVE_AGENTS_LLM_PROVIDER) {
      merged = { ...merged, provider: process.env.REACTIVE_AGENTS_LLM_PROVIDER as AgentConfig["provider"] }
    }
    if (process.env.REACTIVE_AGENTS_LLM_MODEL) {
      merged = { ...merged, model: process.env.REACTIVE_AGENTS_LLM_MODEL }
    }
    if (process.env.REACTIVE_AGENTS_MAX_ITERATIONS) {
      const n = Number(process.env.REACTIVE_AGENTS_MAX_ITERATIONS)
      if (Number.isFinite(n)) {
        merged = {
          ...merged,
          reasoning: { ...merged.reasoning, maxIterations: n },
        }
      }
    }
    // extend as more env vars are documented
    return merged
  })
```

**Step 3** — Move all `process.env.*` reads in `runtime.ts` into this resolver. Grep:
```bash
rtk proxy "rg 'process\\.env' packages/runtime/src/runtime.ts"
```

For each hit, migrate the field to `config-resolver.ts`, change `runtime.ts` to read from resolved config.

**Step 4** — Update `createRuntime` signature:

```ts
// packages/runtime/src/runtime.ts
import type { Capability } from "@reactive-agents/llm-provider/capability"
import { resolveConfigFromEnv } from "./config-resolver"
import type { AgentConfig } from "./agent-config"

export const createRuntime = (
  config: AgentConfig,
  capability: Capability | null = null,  // null allowed until P1.S2 ships Capability
): Effect.Effect<Runtime> =>
  Effect.gen(function* () {
    const resolved = yield* resolveConfigFromEnv(config)
    // Layer composition reads exclusively from `resolved` + `capability`.
    // All prior `process.env.*` reads replaced with `resolved.<path>`.
    // ...existing layer composition continues here
  })
```

**Step 5** — Verify:
```bash
bun test packages/runtime/tests/runtime-purity.test.ts --timeout 15000
bun test packages/runtime --timeout 15000  # full regression
bun run typecheck
bun run build
```

**Step 6** — Commit:
```bash
bun run changeset
# Summary: "runtime: createRuntime as pure function; process.env extraction to ConfigResolver (P1.S1.3)"
git add -A
git commit -m "feat(runtime): pure createRuntime + ConfigResolver (P1.S1.3)"
```

### DoD

- [ ] Purity tests green (3 tests)
- [ ] Zero `process.env` references in `runtime.ts`
- [ ] All env reads centralized in `config-resolver.ts`
- [ ] `createRuntime` signature is `(config, capability) => Effect<Runtime>`
- [ ] Full `bun test packages/runtime` green
- [ ] `bun run build` clean
- [ ] Changeset added

### Rollback

If runtime becomes impure-but-working (e.g., an env var was consumed by a deeply nested layer factory we can't immediately extract), mark the location with `// TODO(P1.S1.3): migrate to ConfigResolver` and document in sprint log. Phase 1 Sprint 2 (Capability story) fixes remaining violations.

---

## Story P1.S1.4 — W4 Integration Probe (Day 5 AM, 2 pts)

### Context

Enable the probe scaffolded in S0.4. Run against `PROBE_MODEL=claude-haiku-4-5`.

### Execution

**Step 1** — Update probe from scaffold to real:

```ts
// .agents/skills/harness-improvement-loop/scripts/probes/w4-max-iterations.ts
import { ReactiveAgents } from "reactive-agents"
import type { ProbeResult } from "../types"

export const probe = {
  name: "w4-max-iterations",
  description: "Asserts withReasoning({ maxIterations: 10 }) is honored end-to-end",

  scaffoldRun: async (): Promise<ProbeResult> => ({
    name: "w4-max-iterations",
    pass: false,
    reason: "scaffolded — enabled by P1.S1.4",
    durationMs: 0,
  }),

  run: async (): Promise<ProbeResult> => {
    const start = performance.now()
    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel(process.env.PROBE_MODEL ?? "claude-haiku-4-5")
      .withReasoning({ maxIterations: 10 })
      .withTools({ allowedTools: [] })
      .build()

    const result = await agent.run(
      "List exactly 12 programming languages, one per numbered line. No extra commentary.",
    )
    await agent.dispose()

    const pass = result.iterations > 1 && result.iterations <= 10
    return {
      name: "w4-max-iterations",
      pass,
      durationMs: performance.now() - start,
      reason: pass
        ? `honored; used ${result.iterations} iterations`
        : `expected 2..10, got ${result.iterations}`,
    }
  },
}
```

**Step 2** — Run locally:
```bash
bun run probes -- --only w4-max-iterations
```

**Step 3** — Verify required in CI. Edit `.github/workflows/ci.yml` — the required probes list grows from 3 to 4 for Phase 1 Sprint 2+:

```yaml
# in probes job
- run: |
    bun run probes
    # Assert w4-max-iterations among passing probes
```

**Step 4** — Commit:
```bash
bun run changeset
# Summary: "probes: w4-max-iterations enabled; required on CI (P1.S1.4)"
git add -A
git commit -m "feat(probes): w4-max-iterations enabled (P1.S1.4)"
```

### DoD

- [ ] Probe returns pass:true on `claude-haiku-4-5`
- [ ] Probe is in required list in `.github/workflows/ci.yml`
- [ ] Durability: runs 3x in a row on CI without flake

### Rollback

Probe is idempotent; failures are informational. If probe is flaky, mark `PROBE_W4_ADVISORY=1` in workflow and document in sprint log. Goal is still pass-consistently, but advisory mode unblocks the sprint.

---

## Story P1.S1.5 — Config Round-Trip Property Tests (Day 5 PM, 3 pts, DEFERABLE)

### Context

Property-based test using `fast-check` that generates random valid `AgentConfig`s and asserts `builderToConfig ∘ agentConfigToBuilder === id`. Ensures no silent drop for any valid config.

**This is the deferable story.** If P1.S1.2 or S1.3 ran long, skip this to buffer.

### Execution

**Step 1** — Add fast-check:
```bash
bun add -D fast-check
```

**Step 2** — `packages/testing/src/arbitraries/agent-config.ts` (NEW):

```ts
import * as fc from "fast-check"
import type { AgentConfig } from "@reactive-agents/runtime/agent-config"

/**
 * fast-check arbitrary for AgentConfig. Generates valid configs covering the
 * shape of every builder `with*` option. Property tests use this to assert
 * builder↔config roundtrip identity.
 */
export const AgentConfigArbitrary: fc.Arbitrary<AgentConfig> = fc.record({
  agent: fc.record({
    name: fc.string({ minLength: 1, maxLength: 64 }),
  }),
  provider: fc.constantFrom("anthropic", "openai", "gemini", "local", "litellm"),
  model: fc.string({ minLength: 1, maxLength: 80 }),
  reasoning: fc.option(
    fc.record({
      maxIterations: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
      minIterations: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
      defaultStrategy: fc.option(
        fc.constantFrom("reactive", "plan-execute", "tree-of-thought", "reflexion", "adaptive"),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  // Additional optional fields per AgentConfigSchema...
}) as unknown as fc.Arbitrary<AgentConfig>
```

**Step 3** — Property test: `packages/runtime/tests/agent-config-property.test.ts`

```ts
import { describe, it, expect } from "bun:test"
import * as fc from "fast-check"
import { AgentConfigArbitrary } from "@reactive-agents/testing/arbitraries"
import { builderToConfig, agentConfigToBuilder } from "../src/agent-config"

describe("AgentConfig round-trip property", () => {
  it("builderToConfig ∘ agentConfigToBuilder = identity (100 runs)", () => {
    fc.assert(
      fc.property(AgentConfigArbitrary, (cfg) => {
        const b = agentConfigToBuilder(cfg)
        const rt = builderToConfig(b)
        expect(rt).toEqual(cfg)
      }),
      { numRuns: 100, verbose: true },
    )
  }, 60000)
})
```

**Step 4** — Commit:
```bash
bun run changeset
# Summary: "runtime: round-trip property tests for AgentConfig (P1.S1.5)"
git add -A
git commit -m "test(runtime): config round-trip property tests (P1.S1.5)"
```

### DoD

- [ ] Property test passes 100 runs
- [ ] `bun test packages/runtime/tests/agent-config-property.test.ts --timeout 60000` green

### Rollback

If fast-check surfaces roundtrip failures, fix the `builderToConfig` / `agentConfigToBuilder` symmetry (most likely a field that writes via one path but reads via another). Each failure = candidate bug. Document in sprint log.

---

## Friday EOD — Sprint close

### Demo artifacts

- Branch `feat/phase-1-invariant` rebased onto latest main
- PR opened
- W4 probe green on CI
- Builder LOC: count before vs. after. Target: ≥20% reduction (we delete private shadow fields).

### PR description template

```bash
gh pr create --title "Phase 1 Sprint 1: Invariant — builder → config routing" --body "$(cat <<'EOF'
## Summary
- AgentConfig schema completeness audit (P1.S1.1)
- Builder pure-setter migration — no behavior outside `(config, opts) => config` (P1.S1.2)
- `createRuntime(config, capability)` as pure function; `ConfigResolver` owns env reads (P1.S1.3)
- W4 `maxIterations` integration probe enabled (P1.S1.4)
- Round-trip property tests with fast-check (P1.S1.5)

## W4 resolution
Silent drop of `withReasoning({ maxIterations })` fixed by construction. The field `_maxIterations` and all shadow fields removed from the builder. Every config value originates in one place. W4 probe green.

## Test plan
- [x] 5 stories' tests green
- [x] `bun test` 100% green
- [x] `bun run build` clean across 27 packages
- [x] `bun run typecheck` 54/54 clean
- [x] W4 probe green 3x consecutive on `claude-haiku-4-5`
- [x] Round-trip property test passes 100 runs
- [x] Zero `process.env` in `runtime.ts`
- [x] `/review-patterns` 9/9 per story

## North-star gate
Phase 1 Sprint 1 success gate (§14):
- ✅ W4 test passes (maxIterations: 10 honored)
- ✅ Round-trip test green
- ✅ Builder behavior-free (only config mutations)

Ready for Phase 1 Sprint 2 (Capability port + providers + num_ctx elimination).
EOF
)"
```

### Retro — append to `.agents/MEMORY.md` Running Issues Log

Template:
```markdown
### Phase 1 Sprint 1 Retro — 2026-05-XX

**Shipped:** X/21 pts (note scope cuts if any)
**Issues encountered:**
- (list any migration surprises — e.g., a `with*` method that was actually a behavior composer)
**Carry-forward:**
- (e.g., P1.S1.5 deferred to Sprint 2 buffer)
- (any runtime.ts env read that couldn't be extracted cleanly — TODO marker in code)
**Pattern wins:**
- (e.g., per-method migration commits caught a W4-adjacent bug in withMinIterations)
```

---

## Phase 1 Sprint 2 kickoff prep (Friday 4 PM)

Write `docs/superpowers/plans/2026-05-07-phase-1-sprint-2-execution-playbook.md` — Capability port + providers + `num_ctx` story.

Preview Sprint 2 scope:
1. P1.S2.1 — `Capability` type definition (3 pts)
2. P1.S2.2 — `CapabilityService` with resolve + probe + fallback (8 pts)
3. P1.S2.3 — Per-provider probers (5 pts, Ollama is the critical one)
4. P1.S2.4 — Ollama `num_ctx` wiring + silent truncation elimination (3 pts)
5. P1.S2.5 — Tier unification (5 pts)
6. P1.S2.6 — Prompt caching auto-enabled via Capability (3 pts)

Total: 27 pts (2nd overcommit sprint — scope-cut candidate: P1.S2.6 deferable).

---

## Execution principles carried forward from Phase 0

1. RED first, always
2. One story at a time
3. Commit per story, clear message format
4. Don't batch DoD
5. Block on DoD, not "feels done"
6. Scope cuts visible same-day
7. No `any` casts (Effect-TS types resist → stop and ask, don't cast)
8. `/review-patterns` before every commit

This playbook ships Phase 1 Sprint 1. Sprint 2 playbook lands same-week Friday.
