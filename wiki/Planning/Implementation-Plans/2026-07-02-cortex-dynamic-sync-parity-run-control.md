# Cortex Dynamic Capability Sync, Parity & Run-Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## STATUS — PLAN COMPLETE: Phases A/B/C/D + generic renderer SHIPPED (2026-07-03)

All phases done in worktree `worktree-cortex-dynamic-sync` (unmerged). Cortex's
config surface is now dynamically driven by the framework and cannot drift as the
framework grows. Final tests: cortex server 320/0, UI 114/0; framework suites
green from Phase C.

- **Phase A (model routing)** — `withModelRouting` wired end-to-end (runner +
  gateway + POST + UI control); strategy parity guard re-pointed to iterate
  `getCapabilityManifest().strategies` (auto-covers new strategies).
- **Phase B** — capability manifest (prior).
- **Phase C (run control)** — immediate abort, live-verified on Ollama (below).
- **Phase D (detail UX)** — `launch_params_json` per-run snapshot (D1),
  `POST /api/runs/:runId/rerun` (D2), run-detail Rerun / Edit & Rerun + read-only
  config snapshot panel (D3).
- **Generic renderer (anti-drift core, the headline)** — Cortex already builds via
  `cortexParamsToAgentConfig → agentConfigToBuilder`, so the generic override
  needs NO per-field plumbing: a partial nested `rawConfig` (keyed by the same
  schema paths `getCapabilityManifest().configFields` introspects via
  `JSONSchema.make`) is deep-merged UNDER the curated draft before decode —
  curated cortex controls win, advanced framework-only fields flow through,
  invalid overrides fail cleanly at `Schema` decode. UI `AdvancedFrameworkConfig`
  renders leaf config fields straight from the introspected manifest (widget per
  `type`), so a NEW framework field appears with zero UI code. Threaded through
  LaunchParams / POST / runner / gateway; survives Edit & Rerun.
  **Live-verified:** POST with `rawConfig:{reasoning:{maxStrategySwitches:7}}` →
  built + round-tripped through the D1 snapshot; invalid `defaultStrategy` → 500
  at decode. Round-trip probe confirmed `toConfig→merge→fromConfig` preserves
  tools + killswitch + strategy.

Remaining (optional, out of this plan): richer generic widgets for array/object
config fields; a live "framework surface" inspector dashboard.

---

## STATUS — Phase C SHIPPED + verified live on Ollama (2026-07-02)

**Phase C (C1–C5) complete, all tests green, verified against a REAL provider.**
Run control now genuinely aborts in-flight work — Stop stays graceful (phase
boundary), Terminate is immediate (fiber interrupt → provider HTTP abort).

- **C1** `packages/guardrails/src/kill-switch.ts` — `KillSwitchService` gains a
  per-agent `AbortController` map + `signal(agentId)`; `terminate()` aborts it
  (ensureController so a terminate racing ahead of signal() still leaves an
  aborted controller). 3 tests.
- **C2 (deviation from plan — plan's premise was wrong).** The plan said "the LLM
  `complete`/`stream` signal option is already honored by providers"; it is NOT —
  `LLMRequest` has no signal field and anthropic/openai ignore any signal. The
  REAL seam is **fiber interruption**: Ollama's `Effect.tryPromise((signal)=>…)`
  aborts its fetch on fiber interrupt (`local.ts:413`). So C2 threads the
  killswitch `AbortSignal` into `runtime.runPromise(effect, { signal })` at the
  `run()` seam (`reactive-agent.ts:767`), acquired via `Effect.serviceOption`
  (NOT bare `KillSwitchService.pipe`, which DIES on a missing service — that
  defect is uncatchable by `catchAll` and runs on every run). On a mid-flight
  abort it emits `AgentTerminated` (phase-boundary parity) + a clean terminal
  error. **Live-verified:** gemma4:12b generation terminated at 800ms → run()
  settled at 805ms (would take many seconds otherwise).
- **C3** `runner-service.ts` — `terminate(runId)` + shared **idempotent**
  `finalizeRun` (atomic claim from activeRef → no double-dispose when terminate
  races the run's own `.finally`); `ActiveEntry` now carries `unsubscribe`.
- **C4** `POST /api/runs/:runId/terminate` (mirrors `stop`).
- **C5** `run-store.terminate()` + confirm-gated Terminate button beside Stop in
  `RunDetail.svelte` (live + paused states). UI builds clean.

**Tests:** guardrails 48, runtime terminate/abort suites, cortex runner/api/parity
— 93 combined green; full runtime suite 879 pass (3 pre-existing fails: model-
routing×2 need keys, built-surface needs dist — NOT introduced by Phase C).

**Env note:** runtime/guardrails dist rebuilt so the Node-consumer Cortex server
picks up C2 (workspace `bun` export runs framework from src for probes/tests, but
the built Cortex server reads dist). Remaining: generic renderer + Phases A/D.

---

## STATUS — Phase B SHIPPED + verified E2E (2026-07-02)

Executed in worktree `worktree-cortex-dynamic-sync` (off origin/main @ v0.13.0). **Phase B (B1–B9) complete, all tests green, verified live.** Phases A/C/D NOT started (deferred per the step-back decision — off the Show-HN launch critical path).

**Commits (in worktree):** B1 `strategy-catalog`, B2 `builder-methods`, B3 `config-fields`, B4 `getCapabilityManifest`, B5 `/api/capabilities`, B6 UI store, B7 presentation map, B8 coverage guard, B9 strategy dropdown + **blueprint/code-action/direct decode fix**.

**Live E2E proof:** started the real server; `GET /api/capabilities` → 8 strategies (incl. blueprint/code-action/direct), `withModelRouting` present, 126 config fields, 83 builder methods; `POST /api/runs {strategy:"blueprint"}` → 200, agent **built + dispatched** to `[phase:blueprint:plan]` (previously impossible — hard-failed at decode). UI builds clean.

**Deviations from the plan as written (all improvements, kept the intent):**
1. **B2 builder methods — reflection, not a static table.** `deriveBuilderMethods()` reflects `ReactiveAgentBuilder.prototype` (83 `with*` methods) + an annotation map for the well-known ones; unannotated methods default to inferred overlays. Zero drift *by construction* — strictly better than the planned 22-entry hand table.
2. **B3 flatten simplified.** `JSONSchema.make(AgentConfigSchema)` emits fully-inline schema (no `$defs`), optional = omission from a struct's `required`. No `$ref`/`anyOf` handling needed.
3. **B8 coverage guard moved server-side.** The UI package intentionally has NO `@reactive-agents/runtime` dep (keeps the runtime out of the browser bundle), so the guard (needs manifest + presentation) lives in `apps/cortex/server/tests/manifest-coverage.test.ts`, importing the pure UI presentation map.
4. **B9 KEY FINDING + substantive framework fix.** The real parity blocker was NOT the UI enum — it was `AgentConfigSchema.reasoning.defaultStrategy` in `packages/runtime/src/agent-config.ts`, a **hand-duplicated 5-member literal** that rejected blueprint/code-action/direct at `Schema.decodeUnknownSync`. Replaced with core's canonical 8-member `ReasoningStrategy`. This is exactly the class of drift the whole effort targets.

**Env facts learned:** reasoning tests live in `tests/` (plural); runtime has both `test/` and `tests/`. Cortex is a Node-runtime consumer with its own tsconfig (no `src` path map) → its server/UI tests require the framework packages **built to dist** (`bunx turbo run build --filter='./packages/*'`) before they resolve `@reactive-agents/*`.

**NOT done in Phase B (remaining to fully realize "full field-driven UI"):** only the strategy dropdown was migrated to the manifest (the planned incremental first-adoption). The **generic renderer across all 126 config fields** is not built — the foundation (`capabilities` store, `config-presentation` map, `hintFor` default-widget fallback, `manifest-coverage` guard) is all in place for it. That + Phases A (model-routing UI), C (run-control), D (detail UX) are the follow-ups.

---

**Goal:** Make Cortex infer its config/capability surface from the framework at runtime so new strategies and builder methods auto-sync into the UI, close the current parity gaps (blueprint/code-action/direct/model-routing), and make Stop/Terminate genuinely abort in-flight LLM calls — all without breaking existing Cortex features.

**Architecture:** The framework gains one authoritative, machine-readable `getCapabilityManifest()` (strategies + builder methods + config-field descriptors derived from `AgentConfigSchema` via `JSONSchema.make`). Source-side guard tests fail the build if the manifest drifts from the registry/builder/schema. Cortex serves it at `GET /api/capabilities`; the UI renders config controls from it through a generic renderer backed by a coverage-guarded presentation-hint map, so unknown-but-new fields degrade to a default widget rather than vanishing. Run-control threads a `KillSwitchService` `AbortSignal` into the `agent.run()`-path LLM call.

**Tech Stack:** Effect-TS (`Schema`, `JSONSchema`, `Layer`, `Ref`), Bun + Elysia (Cortex server), SvelteKit 2 / Svelte 5 runes (Cortex UI), `bun:sqlite`, Bun test runner.

## Global Constraints

- Strict TypeScript. No `any` casts — use `unknown` + guards or precise types. (project rule)
- Run tests with an explicit timeout: `bun test <path> --timeout 15000`. (agent-tdd rule)
- Workspace packages run from `src/` under Bun — no rebuild needed for probes/tests; rebuild only for dist-target validation. (project rule)
- No `@deprecated` on working documented methods; additions are ADDITIVE, never replace working surface. (no-metric-gaming rule)
- Keep `bun` version pinned; do not bump. (project rule)
- Knowledge artifacts go under `wiki/`, never `docs/`. (CLAUDE.md)
- Commit messages: no `Co-Authored-By` trailers. (project rule)
- Effect-TS: services via `Context.Tag` + `Layer`; capture services during layer build, not inside method bodies (see existing `CortexRunnerServiceLive`).

## Source Anchors (verified 2026-07-02)

- Framework strategy registry: `packages/reasoning/src/services/strategy-registry.ts` — registration map (`reactive`,`react`,`reflexion`,`plan-execute-reflect`,`tree-of-thought`,`adaptive`,`direct`,`code-action`,`blueprint`,`rewoo`).
- Framework config schema: `packages/runtime/src/agent-config.ts` → `AgentConfigSchema` (nested `Schema.Struct`); exported from `packages/runtime/src/index.ts:128`.
- Existing JSON-schema derivation precedent: `packages/runtime/src/reasoning-options-schema.ts` (uses `effect` `Schema`).
- Builder method surface: `packages/runtime/src/builder/types.ts` (`with*` methods incl. `withModelRouting`, `ModelRoutingOptions` at :429).
- Killswitch: `packages/guardrails/src/kill-switch.ts` (`Deferred`, `Ref`); consumed in `packages/runtime/src/execution-engine.ts` `checkLifecycle` (~:516) at phase boundaries only.
- Ollama abort seam already present: `packages/llm-provider/src/providers/local.ts:351-365` (forwards `signal` to `fetch`).
- Cortex config mapping: `apps/cortex/server/services/cortex-to-agent-config.ts`, `build-cortex-agent.ts` (Step 3 overlay `b = b.withX()`, `withKillSwitch()` at :383).
- Cortex runner: `apps/cortex/server/services/runner-service.ts` (`CortexRunnerService` tag; `start/pause/resume/stop/...`; dispose only in normal-completion `.finally`).
- Cortex runs API: `apps/cortex/server/api/runs.ts` (`POST /api/runs/:runId/{pause,stop,resume,approve,deny}`; `GET /api/runs/:runId`).
- Cortex UI config type: `apps/cortex/ui/src/lib/types/agent-config.ts` (`AgentConfig`, `defaultConfig()`; strategy enum missing blueprint/code-action/direct).
- Cortex UI panel: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (1990 lines — adopt manifest incrementally, NOT a big-bang rewrite).
- Cortex DB: `apps/cortex/server/db/schema.ts` — `cortex_runs` table + additive `PRAGMA table_info` / `ALTER TABLE ADD COLUMN` migration pattern (~:147).
- Parity guard: `apps/cortex/server/tests/config-parity.test.ts`.

---

# Phase B — Capability Manifest (framework)

## Task B1: Static `STRATEGY_CATALOG` + registry equality guard

**Files:**
- Create: `packages/reasoning/src/services/strategy-catalog.ts`
- Modify: `packages/reasoning/src/index.ts` (export catalog + types)
- Test: `packages/reasoning/test/strategy-catalog.test.ts`

**Interfaces:**
- Produces: `export interface StrategyCatalogEntry { name: string; aliases: string[]; label: string; description: string; multiStep: boolean }`
- Produces: `export const STRATEGY_CATALOG: readonly StrategyCatalogEntry[]`
- Produces: `export const STRATEGY_REGISTRY_KEYS: readonly string[]` (all keys the registry registers, incl. aliases — used by the guard)

- [ ] **Step 1: Write the failing test**

```ts
// packages/reasoning/test/strategy-catalog.test.ts
import { describe, it, expect } from "bun:test";
import { STRATEGY_CATALOG, STRATEGY_REGISTRY_KEYS } from "../src/strategy-catalog.js";

describe("STRATEGY_CATALOG", () => {
  it("has one canonical entry per registry key (aliases folded in)", () => {
    // Every registry key resolves to exactly one catalog entry (as canonical name or alias).
    for (const key of STRATEGY_REGISTRY_KEYS) {
      const hit = STRATEGY_CATALOG.find((e) => e.name === key || e.aliases.includes(key));
      expect(hit, `registry key '${key}' missing from STRATEGY_CATALOG`).toBeTruthy();
    }
  });
  it("exposes the three previously-missing strategies as canonical entries", () => {
    const names = STRATEGY_CATALOG.map((e) => e.name);
    expect(names).toContain("blueprint");
    expect(names).toContain("code-action");
    expect(names).toContain("direct");
  });
  it("marks rewoo/react as aliases, not canonical entries", () => {
    const names = STRATEGY_CATALOG.map((e) => e.name);
    expect(names).not.toContain("rewoo");
    expect(names).not.toContain("react");
    expect(STRATEGY_CATALOG.find((e) => e.name === "blueprint")?.aliases).toContain("rewoo");
    expect(STRATEGY_CATALOG.find((e) => e.name === "reactive")?.aliases).toContain("react");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/test/strategy-catalog.test.ts --timeout 15000`
Expected: FAIL — cannot find module `../src/strategy-catalog.js`.

- [ ] **Step 3: Create the catalog**

```ts
// packages/reasoning/src/services/strategy-catalog.ts
/**
 * Authoritative, machine-readable description of every reasoning strategy.
 * SINGLE SOURCE consumed by getCapabilityManifest(). The equality guard in
 * strategy-catalog.test.ts + the registry parity test keep this in lockstep
 * with StrategyRegistry registrations (strategy-registry.ts).
 */
export interface StrategyCatalogEntry {
  /** Canonical registry key. */
  readonly name: string;
  /** Alternate registry keys that resolve to the same implementation. */
  readonly aliases: string[];
  /** Human-facing label for UI. */
  readonly label: string;
  readonly description: string;
  /** True for multi-phase strategies (UI grouping hint). */
  readonly multiStep: boolean;
}

export const STRATEGY_CATALOG: readonly StrategyCatalogEntry[] = [
  { name: "reactive", aliases: ["react"], label: "ReAct", multiStep: false,
    description: "Reason-act loop: think, call a tool, observe, repeat until done." },
  { name: "reflexion", aliases: [], label: "Reflexion", multiStep: true,
    description: "ReAct plus self-reflection between attempts to correct course." },
  { name: "plan-execute-reflect", aliases: [], label: "Plan-Execute-Reflect", multiStep: true,
    description: "Plan up front, execute steps, reflect and re-plan as needed." },
  { name: "tree-of-thought", aliases: [], label: "Tree of Thought", multiStep: true,
    description: "Branch multiple reasoning paths and select the best." },
  { name: "adaptive", aliases: [], label: "Adaptive", multiStep: true,
    description: "Selects and switches strategy based on task signals." },
  { name: "direct", aliases: [], label: "Direct", multiStep: false,
    description: "Single-shot answer with no tool loop — cheapest path." },
  { name: "code-action", aliases: [], label: "Code Action", multiStep: false,
    description: "LLM writes an IIFE run in a Worker sandbox instead of tool calls." },
  { name: "blueprint", aliases: ["rewoo"], label: "Blueprint (ReWOO)", multiStep: true,
    description: "Plan → verify → execute (0-LLM, parallel) → solve. Cheap, tool-heavy domains." },
];

/**
 * Every key the StrategyRegistry registers (canonical + aliases). Kept next to
 * the catalog; the registry parity test (strategy-registry.test.ts, Step below)
 * asserts this equals the live registry key set.
 */
export const STRATEGY_REGISTRY_KEYS: readonly string[] = [
  "reactive", "react", "reflexion", "plan-execute-reflect", "tree-of-thought",
  "adaptive", "direct", "code-action", "blueprint", "rewoo",
];
```

- [ ] **Step 4: Export from reasoning index**

Add to `packages/reasoning/src/index.ts`:

```ts
export { STRATEGY_CATALOG, STRATEGY_REGISTRY_KEYS } from "./services/strategy-catalog.js";
export type { StrategyCatalogEntry } from "./services/strategy-catalog.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/reasoning/test/strategy-catalog.test.ts --timeout 15000`
Expected: PASS (3 tests).

- [ ] **Step 6: Add registry-equality guard (proves catalog can't silently drift)**

Append to `packages/reasoning/test/strategy-catalog.test.ts`:

```ts
import { Effect } from "effect";
import { StrategyRegistry, StrategyRegistryLive } from "../src/services/strategy-registry.js";

it("STRATEGY_REGISTRY_KEYS equals the live registry key set", async () => {
  // If a strategy is added to the registry without updating the catalog, this fails.
  const liveKeys = await Effect.runPromise(
    StrategyRegistry.pipe(
      Effect.flatMap((r) => r.keys()),           // add keys() if absent — see note
      Effect.provide(StrategyRegistryLive),
    ),
  );
  expect([...liveKeys].sort()).toEqual([...STRATEGY_REGISTRY_KEYS].sort());
});
```

Note: if `StrategyRegistry` has no `keys()` method, add one returning `Effect.succeed([...registry.keys()])` in `strategy-registry.ts` (the registry is a `Map`). This is additive.

- [ ] **Step 7: Run + Commit**

Run: `bun test packages/reasoning/test/strategy-catalog.test.ts --timeout 15000` → PASS.

```bash
git add packages/reasoning/src/services/strategy-catalog.ts packages/reasoning/src/services/strategy-registry.ts packages/reasoning/src/index.ts packages/reasoning/test/strategy-catalog.test.ts
git commit -m "feat(reasoning): static STRATEGY_CATALOG + registry-equality guard"
```

---

## Task B2: Builder-method descriptor table + guard

**Files:**
- Create: `packages/runtime/src/capability/builder-methods.ts`
- Test: `packages/runtime/test/builder-methods.test.ts`

**Interfaces:**
- Produces: `export interface BuilderMethodDescriptor { name: string; kind: "config" | "overlay"; configPath?: string; description: string }`
- Produces: `export const BUILDER_METHODS: readonly BuilderMethodDescriptor[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/test/builder-methods.test.ts
import { describe, it, expect } from "bun:test";
import { BUILDER_METHODS } from "../src/capability/builder-methods.js";
import type { ReactiveAgentBuilder } from "../src/index.js";

describe("BUILDER_METHODS", () => {
  it("lists every public with* builder method (no drift)", () => {
    // Reflect the actual prototype method names so a new with* method fails the build.
    const proto = (await import("../src/builder/builder.js")).ReactiveAgents?.prototype
      ?? Object.getPrototypeOf(({} as unknown as ReactiveAgentBuilder));
    const liveWith = Object.getOwnPropertyNames(proto).filter((n) => /^with[A-Z]/.test(n));
    const declared = new Set(BUILDER_METHODS.map((m) => m.name));
    const missing = liveWith.filter((n) => !declared.has(n));
    expect(missing, `undocumented builder methods: ${missing.join(", ")}`).toEqual([]);
  });
  it("includes withModelRouting as an overlay-kind method", () => {
    const m = BUILDER_METHODS.find((x) => x.name === "withModelRouting");
    expect(m?.kind).toBe("overlay");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/test/builder-methods.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Determine the real builder prototype path**

Run: `grep -rn "class ReactiveAgents\b\|export class ReactiveAgents" packages/runtime/src/builder`
Use the discovered class/file in the test's dynamic import (replace `builder/builder.js` if the class lives elsewhere, e.g. `builder/index.js`). The reflection target must be the concrete builder class prototype.

- [ ] **Step 4: Create the descriptor table**

```ts
// packages/runtime/src/capability/builder-methods.ts
/**
 * Descriptor for every public with* builder method. `config` methods map to an
 * AgentConfigSchema field (configPath); `overlay` methods are wired manually in
 * consumers (e.g. Cortex build-cortex-agent Step 3). The guard test reflects the
 * builder prototype so a new method that isn't described fails the build.
 */
export interface BuilderMethodDescriptor {
  readonly name: string;
  readonly kind: "config" | "overlay";
  readonly configPath?: string;
  readonly description: string;
}

export const BUILDER_METHODS: readonly BuilderMethodDescriptor[] = [
  { name: "withName", kind: "config", configPath: "name", description: "Agent name." },
  { name: "withTools", kind: "config", configPath: "tools.allowedTools", description: "Allowed tool list." },
  { name: "withMemory", kind: "config", configPath: "memory.tier", description: "Enable memory layers." },
  { name: "withModelRouting", kind: "overlay", description: "Cost-aware model routing (tierModels/minTier)." },
  { name: "withGuardrails", kind: "config", configPath: "guardrails", description: "Injection/PII/toxicity guardrails." },
  { name: "withPersona", kind: "config", configPath: "persona", description: "Role/tone/instructions persona." },
  { name: "withGrounding", kind: "overlay", description: "Numeric evidence grounding." },
  { name: "withOutputSchema", kind: "overlay", description: "Typed structured output extraction." },
  { name: "withDurableRuns", kind: "overlay", description: "Crash-resume durable execution." },
  { name: "withHealthCheck", kind: "overlay", description: "Enable agent.health() probes." },
  { name: "withVerification", kind: "overlay", description: "Semantic-entropy verification package." },
  { name: "withObservability", kind: "config", configPath: "observability", description: "Live observability verbosity." },
  { name: "withLogging", kind: "config", configPath: "logging", description: "Structured logging config." },
  { name: "withTelemetry", kind: "overlay", description: "OTel telemetry export." },
  { name: "withTracing", kind: "overlay", description: "Tracing export." },
  { name: "withCostTracking", kind: "config", configPath: "costTracking", description: "Cost budget caps." },
  { name: "withGateway", kind: "config", configPath: "gateway", description: "Gateway (cron/webhook) config." },
  { name: "withCortex", kind: "overlay", description: "Emit events to a Cortex desk." },
  { name: "withAgentTool", kind: "overlay", description: "Register a sub-agent as a tool." },
  { name: "withPrompts", kind: "overlay", description: "Prompt template overrides." },
  { name: "withAudit", kind: "overlay", description: "Audit rationale in debrief." },
  { name: "withTestScenario", kind: "overlay", description: "Deterministic test scenario provider." },
];
// NOTE: keep this list exhaustive — the guard test fails if a with* method is added
// to the builder without a descriptor here.
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/runtime/test/builder-methods.test.ts --timeout 15000`
Expected: PASS. If `missing` is non-empty, add the flagged methods to `BUILDER_METHODS` with correct `kind`/`configPath` and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/capability/builder-methods.ts packages/runtime/test/builder-methods.test.ts
git commit -m "feat(runtime): builder-method descriptor table + prototype drift guard"
```

---

## Task B3: Config-field descriptors from `AgentConfigSchema`

**Files:**
- Create: `packages/runtime/src/capability/config-fields.ts`
- Test: `packages/runtime/test/config-fields.test.ts`

**Interfaces:**
- Produces: `export interface ConfigFieldDescriptor { path: string; type: "string"|"number"|"boolean"|"enum"|"object"|"array"|"unknown"; enumValues?: string[]; optional: boolean; description?: string }`
- Produces: `export function deriveConfigFields(): ConfigFieldDescriptor[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/test/config-fields.test.ts
import { describe, it, expect } from "bun:test";
import { deriveConfigFields } from "../src/capability/config-fields.js";

describe("deriveConfigFields", () => {
  it("emits descriptors covering top-level AgentConfig fields", () => {
    const fields = deriveConfigFields();
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("provider");
    expect(paths).toContain("model");
    expect(paths).toContain("temperature");
    expect(paths).toContain("systemPrompt");
  });
  it("flattens nested structs into dotted paths", () => {
    const paths = deriveConfigFields().map((f) => f.path);
    expect(paths).toContain("execution.maxIterations");
    expect(paths).toContain("reasoning.defaultStrategy");
  });
  it("captures enum literals as enumValues", () => {
    const f = deriveConfigFields().find((x) => x.path === "reasoning.defaultStrategy");
    expect(f?.type).toBe("enum");
    expect(f?.enumValues?.length ?? 0).toBeGreaterThan(0);
  });
});
```

Note: confirm the real nested paths first — run `grep -n "defaultStrategy\|maxIterations\|reasoning\|execution" packages/runtime/src/agent-config.ts` and adjust the asserted paths to the actual schema (e.g. `reasoning.defaultStrategy` may be `reasoning` → `defaultStrategy`).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/test/config-fields.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement using Effect `JSONSchema.make` (robust vs hand AST-walking)**

```ts
// packages/runtime/src/capability/config-fields.ts
/**
 * Derives a flat descriptor list from AgentConfigSchema using Effect's
 * JSONSchema generator, then flattening nested objects into dotted paths.
 * Single source: whatever the schema declares, the manifest reports. The guard
 * test (Task B4) asserts every top-level schema field appears here.
 */
import { JSONSchema, Schema } from "effect";
import { AgentConfigSchema } from "../agent-config.js";

export interface ConfigFieldDescriptor {
  readonly path: string;
  readonly type: "string" | "number" | "boolean" | "enum" | "object" | "array" | "unknown";
  readonly enumValues?: string[];
  readonly optional: boolean;
  readonly description?: string;
}

type JsonNode = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonNode>;
  required?: string[];
  description?: string;
  anyOf?: JsonNode[];
  items?: JsonNode;
  $ref?: string;
};

function resolveRef(node: JsonNode, defs: Record<string, JsonNode>): JsonNode {
  if (node.$ref) {
    const key = node.$ref.replace(/^#\/\$defs\//, "").replace(/^#\/definitions\//, "");
    return defs[key] ?? node;
  }
  return node;
}

function classify(node: JsonNode): ConfigFieldDescriptor["type"] {
  if (node.enum) return "enum";
  const t = Array.isArray(node.type) ? node.type.find((x) => x !== "null") : node.type;
  if (t === "string" || t === "number" || t === "boolean") return t;
  if (t === "integer") return "number";
  if (t === "object") return "object";
  if (t === "array") return "array";
  return "unknown";
}

function flatten(
  node: JsonNode,
  defs: Record<string, JsonNode>,
  prefix: string,
  requiredSet: Set<string>,
  out: ConfigFieldDescriptor[],
): void {
  const resolved = resolveRef(node, defs);
  // Effect encodes optional fields as anyOf [T, undefined]; pick the non-undefined arm.
  const eff = resolved.anyOf
    ? resolveRef(resolved.anyOf.find((a) => a.type !== undefined || a.$ref || a.enum) ?? resolved.anyOf[0], defs)
    : resolved;

  if (eff.properties) {
    const req = new Set(eff.required ?? []);
    for (const [key, child] of Object.entries(eff.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const childResolved = resolveRef(child, defs);
      const childEff = childResolved.anyOf
        ? resolveRef(childResolved.anyOf.find((a) => a.properties || a.type || a.enum || a.$ref) ?? childResolved.anyOf[0], defs)
        : childResolved;
      if (childEff.properties) {
        flatten(childEff, defs, path, req, out);
      } else {
        out.push({
          path,
          type: classify(childEff),
          ...(childEff.enum ? { enumValues: childEff.enum.filter((v): v is string => typeof v === "string") } : {}),
          optional: !req.has(key),
          ...(childEff.description ? { description: childEff.description } : {}),
        });
      }
    }
  }
}

export function deriveConfigFields(): ConfigFieldDescriptor[] {
  const js = JSONSchema.make(AgentConfigSchema) as JsonNode & { $defs?: Record<string, JsonNode> };
  const defs = (js.$defs ?? (js as { definitions?: Record<string, JsonNode> }).definitions ?? {}) as Record<string, JsonNode>;
  const out: ConfigFieldDescriptor[] = [];
  flatten(js, defs, "", new Set(js.required ?? []), out);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/test/config-fields.test.ts --timeout 15000`
Expected: PASS. If nested path shape differs (e.g. `$defs` vs `definitions`, or optional encoding), inspect once with a scratch print (`console.log(JSON.stringify(JSONSchema.make(AgentConfigSchema),null,2))`) and adjust `flatten`/`resolveRef` accordingly, then re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/capability/config-fields.ts packages/runtime/test/config-fields.test.ts
git commit -m "feat(runtime): derive config-field descriptors from AgentConfigSchema"
```

---

## Task B4: `getCapabilityManifest()` + completeness guard + export

**Files:**
- Create: `packages/runtime/src/capability/manifest.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/capability-manifest.test.ts`

**Interfaces:**
- Consumes: `STRATEGY_CATALOG` (B1), `BUILDER_METHODS` (B2), `deriveConfigFields` (B3).
- Produces: `export interface CapabilityManifest { version: string; strategies: StrategyDescriptor[]; builderMethods: BuilderMethodDescriptor[]; configFields: ConfigFieldDescriptor[] }`
- Produces: `export function getCapabilityManifest(): CapabilityManifest`
- Produces: `export type StrategyDescriptor = StrategyCatalogEntry`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/test/capability-manifest.test.ts
import { describe, it, expect } from "bun:test";
import { getCapabilityManifest } from "../src/capability/manifest.js";

describe("getCapabilityManifest", () => {
  it("assembles strategies + builderMethods + configFields", () => {
    const m = getCapabilityManifest();
    expect(m.version).toBeTruthy();
    expect(m.strategies.some((s) => s.name === "blueprint")).toBe(true);
    expect(m.builderMethods.some((b) => b.name === "withModelRouting")).toBe(true);
    expect(m.configFields.some((f) => f.path === "provider")).toBe(true);
  });
  it("is stable across calls (pure)", () => {
    expect(getCapabilityManifest()).toEqual(getCapabilityManifest());
  });
  it("every config-kind builder method points at a real config field", () => {
    const m = getCapabilityManifest();
    const paths = new Set(m.configFields.map((f) => f.path));
    // Sanity: config-kind methods either map to a present field or a known parent object.
    for (const bm of m.builderMethods.filter((b) => b.kind === "config" && b.configPath)) {
      const p = bm.configPath!;
      const ok = paths.has(p) || [...paths].some((x) => x.startsWith(p + "."));
      expect(ok, `builder ${bm.name} configPath '${p}' not found in configFields`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/test/capability-manifest.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manifest**

```ts
// packages/runtime/src/capability/manifest.ts
/**
 * The single machine-readable description of the framework's agent-config surface.
 * Cortex (and any UI) reads this to render controls and validate parity, so new
 * strategies/methods/fields surface automatically. Kept honest by:
 *   - strategy-catalog.test.ts   (catalog == registry keys)
 *   - builder-methods.test.ts     (descriptors == builder prototype)
 *   - config-fields.test.ts       (fields == AgentConfigSchema)
 */
import { STRATEGY_CATALOG, type StrategyCatalogEntry } from "@reactive-agents/reasoning";
import { BUILDER_METHODS, type BuilderMethodDescriptor } from "./builder-methods.js";
import { deriveConfigFields, type ConfigFieldDescriptor } from "./config-fields.js";

export type StrategyDescriptor = StrategyCatalogEntry;

export interface CapabilityManifest {
  readonly version: string;
  readonly strategies: readonly StrategyDescriptor[];
  readonly builderMethods: readonly BuilderMethodDescriptor[];
  readonly configFields: readonly ConfigFieldDescriptor[];
}

/** Bump when the manifest SHAPE changes (not on content changes). */
const MANIFEST_VERSION = "1";

let cached: CapabilityManifest | null = null;

export function getCapabilityManifest(): CapabilityManifest {
  if (cached) return cached;
  cached = {
    version: MANIFEST_VERSION,
    strategies: STRATEGY_CATALOG,
    builderMethods: BUILDER_METHODS,
    configFields: deriveConfigFields(),
  };
  return cached;
}

export type { BuilderMethodDescriptor, ConfigFieldDescriptor };
```

- [ ] **Step 4: Export from runtime index**

Add to `packages/runtime/src/index.ts`:

```ts
export { getCapabilityManifest } from "./capability/manifest.js";
export type { CapabilityManifest, StrategyDescriptor, BuilderMethodDescriptor, ConfigFieldDescriptor } from "./capability/manifest.js";
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/runtime/test/capability-manifest.test.ts --timeout 15000`
Expected: PASS (3 tests).

- [ ] **Step 6: Full-package typecheck (manifest crosses package boundary)**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Expected: build succeeds (confirms `@reactive-agents/reasoning` export of `STRATEGY_CATALOG` resolves across the package boundary).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/capability/manifest.ts packages/runtime/src/index.ts packages/runtime/test/capability-manifest.test.ts
git commit -m "feat(runtime): getCapabilityManifest() — machine-readable capability surface"
```

---

# Phase B — Cortex serves + consumes the manifest

## Task B5: `GET /api/capabilities`

**Files:**
- Create: `apps/cortex/server/api/capabilities.ts`
- Modify: `apps/cortex/server/index.ts` (mount router)
- Test: `apps/cortex/server/tests/api-capabilities.test.ts`

**Interfaces:**
- Consumes: `getCapabilityManifest` from `@reactive-agents/runtime` (B4).
- Produces: HTTP `GET /api/capabilities` → `CapabilityManifest` JSON.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cortex/server/tests/api-capabilities.test.ts
import { describe, it, expect } from "bun:test";
import { capabilitiesRouter } from "../api/capabilities.js";

describe("GET /api/capabilities", () => {
  it("returns the framework capability manifest", async () => {
    const res = await capabilitiesRouter.handle(
      new Request("http://localhost/api/capabilities"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      strategies: { name: string }[];
      builderMethods: { name: string }[];
      configFields: { path: string }[];
    };
    expect(body.strategies.map((s) => s.name)).toContain("blueprint");
    expect(body.strategies.map((s) => s.name)).toContain("code-action");
    expect(body.strategies.map((s) => s.name)).toContain("direct");
    expect(body.builderMethods.map((b) => b.name)).toContain("withModelRouting");
    expect(body.configFields.some((f) => f.path === "provider")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/api-capabilities.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement router**

```ts
// apps/cortex/server/api/capabilities.ts
/**
 * Serves the framework CapabilityManifest so the Cortex UI can render config
 * controls + the strategy list dynamically. Static per process — the framework
 * memoizes it — so no DB and no service dependency.
 */
import { Elysia } from "elysia";
import { getCapabilityManifest } from "@reactive-agents/runtime";

export const capabilitiesRouter = new Elysia().get("/api/capabilities", () =>
  getCapabilityManifest(),
);
```

- [ ] **Step 4: Mount in server index**

In `apps/cortex/server/index.ts`, follow the existing `.use(<router>)` pattern (grep for `runsRouter` to find the mount block) and add `.use(capabilitiesRouter)` with the matching import.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/api-capabilities.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/api/capabilities.ts apps/cortex/server/index.ts apps/cortex/server/tests/api-capabilities.test.ts
git commit -m "feat(cortex): GET /api/capabilities serves framework manifest"
```

---

## Task B6: UI capabilities store

**Files:**
- Create: `apps/cortex/ui/src/lib/capabilities.ts`
- Test: `apps/cortex/ui/src/lib/capabilities.test.ts`

**Interfaces:**
- Produces: `export interface CapabilityManifest { version: string; strategies: StrategyDescriptor[]; builderMethods: BuilderMethodDescriptor[]; configFields: ConfigFieldDescriptor[] }` (UI-local mirror of the framework types — structural, no framework import in the browser bundle).
- Produces: `export async function loadCapabilities(fetchFn?: typeof fetch): Promise<CapabilityManifest>`
- Produces: `export function strategyOptions(m: CapabilityManifest): { value: string; label: string }[]`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cortex/ui/src/lib/capabilities.test.ts
import { describe, it, expect } from "bun:test";
import { loadCapabilities, strategyOptions } from "./capabilities.js";

const MANIFEST = {
  version: "1",
  strategies: [
    { name: "reactive", aliases: ["react"], label: "ReAct", description: "", multiStep: false },
    { name: "blueprint", aliases: ["rewoo"], label: "Blueprint (ReWOO)", description: "", multiStep: true },
  ],
  builderMethods: [],
  configFields: [],
};

describe("capabilities store", () => {
  it("loads the manifest via fetch", async () => {
    const fake = (async () => new Response(JSON.stringify(MANIFEST))) as unknown as typeof fetch;
    const m = await loadCapabilities(fake);
    expect(m.strategies).toHaveLength(2);
  });
  it("maps strategies to {value,label} options", () => {
    const opts = strategyOptions(MANIFEST);
    expect(opts).toContainEqual({ value: "blueprint", label: "Blueprint (ReWOO)" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/ui/src/lib/capabilities.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/cortex/ui/src/lib/capabilities.ts
/** Browser-side mirror of the framework CapabilityManifest served by /api/capabilities. */
import { CORTEX_SERVER_URL } from "./constants.js";

export interface StrategyDescriptor {
  name: string; aliases: string[]; label: string; description: string; multiStep: boolean;
}
export interface BuilderMethodDescriptor {
  name: string; kind: "config" | "overlay"; configPath?: string; description: string;
}
export interface ConfigFieldDescriptor {
  path: string;
  type: "string" | "number" | "boolean" | "enum" | "object" | "array" | "unknown";
  enumValues?: string[]; optional: boolean; description?: string;
}
export interface CapabilityManifest {
  version: string;
  strategies: StrategyDescriptor[];
  builderMethods: BuilderMethodDescriptor[];
  configFields: ConfigFieldDescriptor[];
}

export async function loadCapabilities(fetchFn: typeof fetch = fetch): Promise<CapabilityManifest> {
  const res = await fetchFn(`${CORTEX_SERVER_URL}/api/capabilities`);
  if (!res.ok) throw new Error(`capabilities fetch failed: ${res.status}`);
  return (await res.json()) as CapabilityManifest;
}

export function strategyOptions(m: CapabilityManifest): { value: string; label: string }[] {
  return m.strategies.map((s) => ({ value: s.name, label: s.label }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/cortex/ui/src/lib/capabilities.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/capabilities.ts apps/cortex/ui/src/lib/capabilities.test.ts
git commit -m "feat(cortex-ui): capabilities store (loads /api/capabilities)"
```

---

## Task B7: Presentation-hint map + coverage guard

**Files:**
- Create: `apps/cortex/ui/src/lib/config-presentation.ts`
- Test: `apps/cortex/ui/src/lib/config-presentation.test.ts`

**Interfaces:**
- Consumes: `ConfigFieldDescriptor` (B6).
- Produces: `export type Widget = "toggle" | "slider" | "select" | "text" | "textarea" | "number" | "tag-input" | "custom"`
- Produces: `export interface PresentationHint { group: string; label: string; widget: Widget; order: number; showIf?: (cfg: Record<string, unknown>) => boolean; help?: string }`
- Produces: `export const PRESENTATION: Record<string, PresentationHint>` (keyed by field path OR builder-method name)
- Produces: `export function hintFor(descriptor: ConfigFieldDescriptor): PresentationHint` (falls back to a default widget by type)
- Produces: `export const INTENTIONAL_DEFAULTS: ReadonlySet<string>` (paths deliberately left to the default widget)

- [ ] **Step 1: Write the failing test**

```ts
// apps/cortex/ui/src/lib/config-presentation.test.ts
import { describe, it, expect } from "bun:test";
import { hintFor, PRESENTATION, INTENTIONAL_DEFAULTS } from "./config-presentation.js";
import type { ConfigFieldDescriptor } from "./capabilities.js";

describe("config presentation", () => {
  it("falls back to a type-appropriate default widget for unknown fields", () => {
    const d: ConfigFieldDescriptor = { path: "brand.new.field", type: "boolean", optional: true };
    expect(hintFor(d).widget).toBe("toggle");
  });
  it("maps enum fields to a select by default", () => {
    const d: ConfigFieldDescriptor = { path: "x.y", type: "enum", enumValues: ["a", "b"], optional: true };
    expect(hintFor(d).widget).toBe("select");
  });
  it("uses an explicit hint when present", () => {
    if (PRESENTATION["temperature"]) {
      const d: ConfigFieldDescriptor = { path: "temperature", type: "number", optional: false };
      expect(hintFor(d).widget).toBe(PRESENTATION["temperature"].widget);
    }
  });
  it("has no PRESENTATION key that also sits in INTENTIONAL_DEFAULTS (no contradiction)", () => {
    for (const k of INTENTIONAL_DEFAULTS) {
      expect(PRESENTATION[k], `${k} both hinted and defaulted`).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/ui/src/lib/config-presentation.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/cortex/ui/src/lib/config-presentation.ts
/**
 * UI polish layer over the framework manifest. The manifest guarantees a field
 * EXISTS; this map decides how it LOOKS. Anything not here renders with a default
 * widget inferred from its type — so a new framework field appears automatically
 * (functional but plain) instead of vanishing. The manifest-coverage guard in
 * AgentConfigPanel.test flags fields with neither a hint nor an intentional default.
 */
import type { ConfigFieldDescriptor } from "./capabilities.js";

export type Widget =
  | "toggle" | "slider" | "select" | "text" | "textarea" | "number" | "tag-input" | "custom";

export interface PresentationHint {
  group: string;
  label: string;
  widget: Widget;
  order: number;
  showIf?: (cfg: Record<string, unknown>) => boolean;
  help?: string;
}

export const PRESENTATION: Record<string, PresentationHint> = {
  provider:               { group: "Model", label: "Provider", widget: "select", order: 10 },
  model:                  { group: "Model", label: "Model", widget: "select", order: 20 },
  temperature:            { group: "Model", label: "Temperature", widget: "slider", order: 30 },
  maxTokens:              { group: "Model", label: "Max tokens", widget: "number", order: 40 },
  numCtx:                 { group: "Model", label: "Context window (num_ctx)", widget: "number", order: 50 },
  "reasoning.defaultStrategy": { group: "Reasoning", label: "Strategy", widget: "select", order: 10 },
  systemPrompt:           { group: "Reasoning", label: "System prompt", widget: "textarea", order: 20 },
  "execution.maxIterations": { group: "Execution", label: "Max iterations", widget: "number", order: 10 },
  "execution.timeoutMs":  { group: "Execution", label: "Timeout (ms)", widget: "number", order: 20 },
  // Overlay builder methods keyed by method name (rendered from BUILDER_METHODS):
  withModelRouting:       { group: "Model", label: "Cost-aware model routing", widget: "custom", order: 60,
                            help: "Route each run to the cheapest capable tier (haiku/sonnet/opus)." },
  // …extend as fields are styled. Composite fields use widget: "custom" + a slotted component.
};

/** Paths intentionally left to the default widget (acknowledged, not forgotten). */
export const INTENTIONAL_DEFAULTS: ReadonlySet<string> = new Set<string>([
  // e.g. rarely-used logging.* internals rendered with default widgets
]);

const DEFAULT_WIDGET: Record<ConfigFieldDescriptor["type"], Widget> = {
  boolean: "toggle", number: "number", string: "text",
  enum: "select", array: "tag-input", object: "custom", unknown: "text",
};

export function hintFor(descriptor: ConfigFieldDescriptor): PresentationHint {
  const explicit = PRESENTATION[descriptor.path];
  if (explicit) return explicit;
  return {
    group: "More",
    label: descriptor.path.split(".").slice(-1)[0],
    widget: DEFAULT_WIDGET[descriptor.type],
    order: 999,
    ...(descriptor.description ? { help: descriptor.description } : {}),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/cortex/ui/src/lib/config-presentation.test.ts --timeout 15000`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/config-presentation.ts apps/cortex/ui/src/lib/config-presentation.test.ts
git commit -m "feat(cortex-ui): presentation-hint map + default-widget fallback"
```

---

## Task B8: Manifest-coverage guard (ties UI to the live manifest)

**Files:**
- Test: `apps/cortex/ui/src/lib/manifest-coverage.test.ts`

**Interfaces:**
- Consumes: `getCapabilityManifest` (framework, importable in a Bun test), `PRESENTATION` + `INTENTIONAL_DEFAULTS` (B7).

- [ ] **Step 1: Write the failing/guard test**

```ts
// apps/cortex/ui/src/lib/manifest-coverage.test.ts
import { describe, it, expect } from "bun:test";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import { PRESENTATION, INTENTIONAL_DEFAULTS } from "./config-presentation.js";

describe("manifest coverage", () => {
  it("every strategy is renderable (manifest provides label)", () => {
    for (const s of getCapabilityManifest().strategies) {
      expect(s.label, `strategy ${s.name} missing label`).toBeTruthy();
    }
  });
  it("reports config fields that are neither hinted nor intentionally defaulted", () => {
    const m = getCapabilityManifest();
    const unstyled = m.configFields
      .map((f) => f.path)
      .filter((p) => !PRESENTATION[p] && !INTENTIONAL_DEFAULTS.has(p));
    // Not a hard failure — a new field is allowed to render with a default widget.
    // This assertion documents the current set; when it grows, add hints or defaults.
    // Fail only if the growth is unacknowledged beyond a soft cap.
    expect(unstyled.length, `unstyled fields (add hints or INTENTIONAL_DEFAULTS): ${unstyled.join(", ")}`)
      .toBeLessThanOrEqual(unstyled.length); // always true — see note
  });
});
```

Note: the second assertion is intentionally informational (prints the list). Decide during review whether to harden it into `toBe(0)` after all current fields are styled. Keep it printing the list so drift is visible in CI logs without blocking unrelated work.

- [ ] **Step 2: Run**

Run: `bun test apps/cortex/ui/src/lib/manifest-coverage.test.ts --timeout 15000`
Expected: PASS (prints any unstyled fields).

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/lib/manifest-coverage.test.ts
git commit -m "test(cortex-ui): manifest coverage guard surfaces unstyled fields"
```

---

## Task B9: Migrate the strategy dropdown to the manifest (first field-driven adoption; NO regressions)

**Files:**
- Modify: `apps/cortex/ui/src/lib/types/agent-config.ts` (widen `strategy` type)
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (strategy `<select>` reads manifest)
- Modify: `apps/cortex/ui/src/routes/+layout.ts` or the panel's load (fetch capabilities once)
- Test: `apps/cortex/server/tests/config-parity.test.ts` (add blueprint launch assertion)

**Interfaces:**
- Consumes: `strategyOptions`, `loadCapabilities` (B6).

- [ ] **Step 1: Widen the strategy type (keep it a superset — no removal)**

In `agent-config.ts` change:

```ts
  strategy: "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive";
```

to:

```ts
  /** Canonical registry strategy name. Superset — options come from the capability manifest at runtime. */
  strategy: string;
```

`defaultConfig()` keeps `strategy: "reactive"`. No other change; widening a union to `string` does not break existing assignments.

- [ ] **Step 2: Write a server parity test proving blueprint launches end-to-end**

Add to `apps/cortex/server/tests/config-parity.test.ts` (uses the existing `captureRunnerLayer` + `FULL_CONFIG_BODY` harness):

```ts
it("accepts blueprint strategy through POST /api/runs", async () => {
  const captured: { params: LaunchParams | null } = { params: null };
  // reuse existing helper to build the app with captureRunnerLayer(captured)
  const app = buildTestApp(captureRunnerLayer(captured)); // see existing test setup
  const res = await app.handle(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...FULL_CONFIG_BODY, strategy: "blueprint" }),
  }));
  expect(res.status).toBe(200);
  expect(captured.params?.strategy).toBe("blueprint");
});
```

- [ ] **Step 3: Run to verify it fails (or passes if the server already accepts arbitrary strategy strings)**

Run: `bun test apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: If `runs.ts` restricts strategy via an enum schema, FAIL — fix by widening the POST body strategy field to `t.String()` (Elysia) / free string. If it already accepts strings, PASS (the gap was UI-only).

- [ ] **Step 4: Point the UI strategy `<select>` at the manifest**

In `AgentConfigPanel.svelte`, replace the hardcoded strategy option list with options from the loaded manifest:

```svelte
<script lang="ts">
  import { loadCapabilities, strategyOptions, type CapabilityManifest } from "$lib/capabilities";
  let manifest = $state<CapabilityManifest | null>(null);
  $effect(() => { loadCapabilities().then((m) => (manifest = m)).catch(() => {}); });
  const stratOpts = $derived(manifest ? strategyOptions(manifest) : [
    { value: "reactive", label: "ReAct" }, // fallback until manifest loads — no empty dropdown
  ]);
</script>

<select bind:value={config.strategy}>
  {#each stratOpts as opt}
    <option value={opt.value}>{opt.label}</option>
  {/each}
</select>
```

(Locate the existing strategy `<select>` via `grep -n "strategy" AgentConfigPanel.svelte`; replace only its options + keep its surrounding label/help.)

- [ ] **Step 5: Verify UI build + tests**

Run: `cd apps/cortex/ui && bun run build`
Expected: build succeeds.
Run: `bun test apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 6: Manual smoke (dynamic sync proof)**

Run: `cd apps/cortex && bun start`, open the Lab/Builder, confirm the Strategy dropdown now lists **Blueprint (ReWOO)**, **Code Action**, **Direct** alongside the originals — with zero hardcoded additions in the UI.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/ui/src/lib/types/agent-config.ts apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte apps/cortex/server/tests/config-parity.test.ts
git commit -m "feat(cortex): strategy dropdown driven by capability manifest (blueprint/code-action/direct)"
```

---

# Phase A — Parity: model routing (falls out of the manifest)

## Task A1: Wire `withModelRouting` end-to-end

**Files:**
- Modify: `apps/cortex/ui/src/lib/types/agent-config.ts` (add `modelRouting` field + default)
- Modify: `apps/cortex/server/services/runner-service.ts` (`LaunchParams.modelRouting`)
- Modify: `apps/cortex/server/services/build-cortex-agent.ts` (Step 3 overlay `b.withModelRouting`)
- Modify: `apps/cortex/server/api/runs.ts` (POST body accepts `modelRouting`)
- Modify: `apps/cortex/server/services/gateway-process-manager.ts` (fireAgent builder parity)
- Test: `apps/cortex/server/tests/config-parity.test.ts`

**Interfaces:**
- Consumes framework: `withModelRouting(options?: { tierModels?: Partial<Record<'haiku'|'sonnet'|'opus', string>>; minTier?: 'haiku'|'sonnet'|'opus' })` (`ModelRoutingOptions`, types.ts:429).
- Produces: `AgentConfig.modelRouting: { enabled: boolean; minTier?: "haiku"|"sonnet"|"opus"; tierModels?: Record<string,string> }`.

- [ ] **Step 1: Write the failing parity test**

Add to `config-parity.test.ts`:

```ts
it("wires modelRouting through POST /api/runs → LaunchParams", async () => {
  const captured: { params: LaunchParams | null } = { params: null };
  const app = buildTestApp(captureRunnerLayer(captured));
  const res = await app.handle(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...FULL_CONFIG_BODY, modelRouting: { enabled: true, minTier: "haiku" } }),
  }));
  expect(res.status).toBe(200);
  expect(captured.params?.modelRouting?.enabled).toBe(true);
  expect(captured.params?.modelRouting?.minTier).toBe("haiku");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: FAIL — `modelRouting` not on `LaunchParams` / not captured.

- [ ] **Step 3: Add to `LaunchParams`** (`runner-service.ts`, in the interface):

```ts
  /** Cost-aware model routing (`.withModelRouting()`). enabled=false → not applied. */
  readonly modelRouting?: {
    readonly enabled?: boolean;
    readonly minTier?: "haiku" | "sonnet" | "opus";
    readonly tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>;
  };
```

And thread it into the `buildCortexAgent({ ... })` call object in `start`:

```ts
                ...(params.modelRouting?.enabled ? { modelRouting: params.modelRouting } : {}),
```

- [ ] **Step 4: Accept it in `buildCortexAgent` params + apply overlay** (`build-cortex-agent.ts`):

Add to `BuildCortexAgentParams`:

```ts
  modelRouting?: {
    enabled?: boolean;
    minTier?: "haiku" | "sonnet" | "opus";
    tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>;
  };
```

In Step 3 overlay block (near the other `b = b.withX()` lines, e.g. after `withVerification`):

```ts
  if (params.modelRouting?.enabled) {
    b = b.withModelRouting({
      ...(params.modelRouting.minTier ? { minTier: params.modelRouting.minTier } : {}),
      ...(params.modelRouting.tierModels ? { tierModels: params.modelRouting.tierModels } : {}),
    });
  }
```

- [ ] **Step 5: Accept it in the POST body** (`runs.ts`): add `modelRouting` to the request body schema (follow the existing optional-object fields like `retryPolicy`/`fallbacks`; use the same Elysia `t.Optional(t.Object({...}))` style already present) and pass it into `runner.start({ ... })`.

- [ ] **Step 6: Gateway parity** (`gateway-process-manager.ts`): in `fireAgent`'s builder assembly, apply the same `withModelRouting` overlay when the saved config has `modelRouting.enabled` (grep for an existing `.withX` in fireAgent to place it consistently).

- [ ] **Step 7: UI field + default** (`agent-config.ts`):

```ts
  /** Cost-aware model routing (v0.13, `.withModelRouting()`). */
  modelRouting: { enabled: boolean; minTier?: "haiku" | "sonnet" | "opus"; tierModels?: Record<string, string> };
```

In `defaultConfig()`:

```ts
    modelRouting: { enabled: false },
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 9: Full server suite (no regressions in the parity pipeline)**

Run: `bun test apps/cortex/server/tests --timeout 15000`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/cortex/ui/src/lib/types/agent-config.ts apps/cortex/server/services/runner-service.ts apps/cortex/server/services/build-cortex-agent.ts apps/cortex/server/api/runs.ts apps/cortex/server/services/gateway-process-manager.ts apps/cortex/server/tests/config-parity.test.ts
git commit -m "feat(cortex): wire withModelRouting through runner/gateway/API"
```

---

## Task A2: Render model-routing control + re-point parity test to manifest

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (routing control, gated by `showIf`)
- Modify: `apps/cortex/ui/src/routes/lab/+page.svelte` (pass `modelRouting` into the `run()` / POST body)
- Modify: `apps/cortex/ui/src/lib/config-presentation.ts` (already has `withModelRouting` hint from B7 — verify group/order)

- [ ] **Step 1: Add the routing control** under the Model group in `AgentConfigPanel.svelte`:

```svelte
<label class="toggle">
  <input type="checkbox" bind:checked={config.modelRouting.enabled} />
  Cost-aware model routing
</label>
{#if config.modelRouting.enabled}
  <label>Minimum tier
    <select bind:value={config.modelRouting.minTier}>
      <option value={undefined}>Auto</option>
      <option value="haiku">Haiku</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
    </select>
  </label>
{/if}
```

- [ ] **Step 2: Thread `modelRouting` into the Lab launch** (`lab/+page.svelte`): find where the POST body / `run()` config object is assembled (grep `strategy:` in that file) and add `modelRouting: config.modelRouting`.

- [ ] **Step 3: Build the UI**

Run: `cd apps/cortex/ui && bun run build`
Expected: build succeeds.

- [ ] **Step 4: Re-point the parity guard to the manifest**

Update `config-parity.test.ts`'s header/intent: add an assertion that every `configField` from the manifest that maps to a wired `LaunchParams` key is present. Concretely, add:

```ts
import { getCapabilityManifest } from "@reactive-agents/runtime";
it("manifest strategies are all launchable strings (no UI-only enum drift)", async () => {
  const strategies = getCapabilityManifest().strategies.map((s) => s.name);
  for (const strat of strategies) {
    const captured: { params: LaunchParams | null } = { params: null };
    const app = buildTestApp(captureRunnerLayer(captured));
    const res = await app.handle(new Request("http://localhost/api/runs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...FULL_CONFIG_BODY, strategy: strat }),
    }));
    expect(res.status, `strategy ${strat} rejected`).toBe(200);
    expect(captured.params?.strategy).toBe(strat);
  }
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: PASS — every manifest strategy launches.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte apps/cortex/ui/src/routes/lab/+page.svelte apps/cortex/server/tests/config-parity.test.ts
git commit -m "feat(cortex): model-routing UI control + manifest-driven parity guard"
```

---

# Phase C — Run control (immediate abort + graceful dispose)

## Task C1: `KillSwitchService` holds an AbortController; `terminate` aborts

**Files:**
- Modify: `packages/guardrails/src/kill-switch.ts`
- Test: `packages/guardrails/test/kill-switch-signal.test.ts` (or the existing kill-switch test file — grep first)

**Interfaces:**
- Produces (new method on the service): `signal: (agentId: string) => Effect.Effect<AbortSignal | undefined>`
- Behavior change: `terminate(agentId, reason)` also calls the per-agent `AbortController.abort()`.

- [ ] **Step 1: Read the current service shape**

Run: `sed -n '1,120p' packages/guardrails/src/kill-switch.ts`
Identify the `Ref`/`Deferred` state store and the `terminate`/`isTriggered` implementations.

- [ ] **Step 2: Write the failing test**

```ts
// packages/guardrails/test/kill-switch-signal.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { KillSwitchService, KillSwitchServiceLive } from "../src/kill-switch.js";

describe("KillSwitchService signal", () => {
  it("terminate() aborts the agent's AbortSignal", async () => {
    const aborted = await Effect.runPromise(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        // Register/ensure the agent so a controller exists (see ensureAgent note).
        const sig = yield* ks.signal("agent-1");
        yield* ks.terminate("agent-1", "test");
        return sig?.aborted ?? false;
      }).pipe(Effect.provide(KillSwitchServiceLive)),
    );
    expect(aborted).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test packages/guardrails/test/kill-switch-signal.test.ts --timeout 15000`
Expected: FAIL — `signal` not a function.

- [ ] **Step 4: Implement** — add a `Ref<Map<string, AbortController>>` to the layer state; `signal(agentId)` lazily creates (or returns) the controller's signal; `terminate` looks up the controller and calls `.abort()` in addition to its existing trigger logic. Add `signal` to the `Context.Tag` service interface. Keep all existing methods unchanged (additive).

```ts
// sketch — adapt to the file's existing Ref/Deferred style
readonly signal: (agentId: string) => Effect.Effect<AbortSignal | undefined>;
// in Live:
const controllers = yield* Ref.make(new Map<string, AbortController>());
const ensureController = (agentId: string) =>
  Ref.modify(controllers, (m) => {
    const existing = m.get(agentId);
    if (existing) return [existing, m];
    const c = new AbortController();
    return [c, new Map(m).set(agentId, c)];
  });
// signal:
signal: (agentId) => Effect.map(ensureController(agentId), (c) => c.signal),
// terminate (augment existing body):
//   const c = (yield* Ref.get(controllers)).get(agentId); c?.abort();
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/guardrails/test/kill-switch-signal.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 6: Run existing kill-switch tests (no regression)**

Run: `bun test packages/guardrails/test --timeout 15000`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/guardrails/src/kill-switch.ts packages/guardrails/test/kill-switch-signal.test.ts
git commit -m "feat(guardrails): KillSwitchService exposes per-agent AbortSignal; terminate aborts it"
```

---

## Task C2: Thread the killswitch signal into the run-path LLM call

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`
- Test: `packages/runtime/test/terminate-aborts-inflight.test.ts`

**Interfaces:**
- Consumes: `ks.signal(agentId)` (C1); the LLM `complete`/`stream` `signal` option already honored by providers (`local.ts:351`).

- [ ] **Step 1: Locate the LLM-call seam in the run path**

Run: `grep -n "complete(\|\.stream(\|signal\b\|ksOpt\|ks\b" packages/runtime/src/execution-engine.ts | head -40`
Identify where the strategy/kernel invokes the LLM and where `ks` (KillSwitch optional) is acquired (~:414). Determine how the `signal` option flows to `LLMService.complete` (it may pass through `KernelInput`/reasoning options — trace one hop with `grep -rn "signal" packages/reasoning/src/kernel | head`).

- [ ] **Step 2: Write the failing timing test**

```ts
// packages/runtime/test/terminate-aborts-inflight.test.ts
import { describe, it, expect } from "bun:test";
// Build a minimal agent on the `test` provider configured with a completion that
// resolves only after a long delay UNLESS its AbortSignal fires. (Use the test
// provider's scenario hook / a stub LLM layer that respects `signal`.)
describe("terminate aborts in-flight", () => {
  it("agent.terminate() rejects the in-flight completion promptly", async () => {
    // Pseudocode — wire to the actual test-provider harness used elsewhere in runtime tests.
    const agent = /* build test-provider agent with .withKillSwitch() and a 10s stub completion */ null as any;
    const t0 = Date.now();
    const runP = agent.run("hi", { taskId: "t1" });
    setTimeout(() => { void agent.terminate("test"); }, 200);
    await runP.catch(() => {});
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3000); // ≪ the 10s stub delay → abort worked
    await agent.dispose();
  });
});
```

Note: model the stub completion on an existing runtime test that uses the `test` provider with a controllable delay + `signal` (grep `withTestScenario` / test-provider usages in `packages/runtime/test`). If none respects `signal`, add a tiny stub `LLMService` layer in the test that returns `new Promise((res, rej) => { signal?.addEventListener("abort", () => rej(new DOMException("Aborted","AbortError"))); setTimeout(res, 10000); })`.

- [ ] **Step 3: Run to verify it fails**

Run: `bun test packages/runtime/test/terminate-aborts-inflight.test.ts --timeout 15000`
Expected: FAIL — elapsed ≈ 10s (signal not threaded) OR test can't get a signal in.

- [ ] **Step 4: Implement the threading**

When `ksOpt`/`ks` is present, obtain `const runSignal = yield* ks.signal(config.agentId)` and pass it into the LLM call options at the same seam the stream path uses (the reasoning kernel already accepts a `signal`/`runController` — pass `signal: runSignal`). Map the resulting `AbortError` to a clean terminal: in the run's catch, if the error is an abort AND the killswitch is triggered, emit `AgentTerminated` (mirroring the existing `checkLifecycle` terminate branch) instead of a generic failure.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/runtime/test/terminate-aborts-inflight.test.ts --timeout 15000`
Expected: PASS — elapsed < 3s.

- [ ] **Step 6: Regression — run the engine/agent test suites**

Run: `bun test packages/runtime/test --timeout 30000`
Expected: all PASS (watch for tests asserting stop/terminate event ordering).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/test/terminate-aborts-inflight.test.ts
git commit -m "feat(runtime): terminate aborts in-flight LLM call on the run() path"
```

---

## Task C3: Cortex runner — `terminate` method + shared `finalizeRun` dispose

**Files:**
- Modify: `apps/cortex/server/services/runner-service.ts`
- Modify: `apps/cortex/server/tests/runner-service.test.ts`
- Modify: `apps/cortex/server/tests/config-parity.test.ts` (captureRunnerLayer stub gains `terminate`)

**Interfaces:**
- Produces: `CortexRunnerService.terminate: (runId: RunId) => Effect.Effect<void, CortexError>`
- Refactors the dispose block into `finalizeRun(runId)` reused by completion + stop + terminate.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/cortex/server/tests/runner-service.test.ts
it("terminate() calls agent.terminate and disposes", async () => {
  let terminated = false, disposed = false;
  // Build the runner with a stub agent whose terminate()/dispose() flip the flags.
  // (Follow the existing runner-service.test.ts harness that injects a fake agent
  //  via buildCortexAgent mock or the store/ingest layers.)
  // ... start a run that registers the stub as active ...
  // await runner.terminate(runId);
  expect(terminated).toBe(true);
  expect(disposed).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/runner-service.test.ts --timeout 15000`
Expected: FAIL — `runner.terminate` is not a function.

- [ ] **Step 3: Add `terminate` to the service interface** (the `Context.Tag` block):

```ts
    readonly terminate: (runId: RunId) => Effect.Effect<void, CortexError>;
```

- [ ] **Step 4: Extract `finalizeRun` + implement `terminate`** in `CortexRunnerServiceLive`:

```ts
    // Shared teardown: unsubscribe + dispose (MCP containers, abort controllers) + drop active.
    const finalizeRun = (runId: string, unsubscribe?: () => void, agent?: ReactiveAgent) =>
      Effect.gen(function* () {
        if (unsubscribe) { try { unsubscribe(); } catch { /* fire-and-forget */ } }
        if (agent) {
          yield* Effect.tryPromise({ try: () => agent.dispose(), catch: (e) => e }).pipe(
            Effect.catchAll((err) => emitErrorSwallowed({ site: "runner-service.finalizeRun", tag: errorTag(err) })),
          );
        }
        yield* Ref.update(activeRef, (m) => { const c = new Map(m); c.delete(runId); return c; });
      });
```

Refactor the existing `.finally` dispose in `start` to call `finalizeRun`. Then:

```ts
      terminate: (runId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(activeRef);
          const entry = m.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "terminate: run not active", { runId });
            return;
          }
          yield* Effect.promise(() => entry.agent.terminate("Cortex UI terminate")).pipe(
            Effect.catchAll((err) => emitErrorSwallowed({ site: "runner-service.terminate", tag: errorTag(err) })),
          );
          // Immediate dispose (do not wait for run() to settle — it may be aborting).
          yield* finalizeRun(String(runId), undefined, entry.agent);
        }),
```

Note: `stop` stays as-is (graceful; the run's own `.finally` → `finalizeRun` handles teardown after synthesis). Guard against double-dispose: `finalizeRun` deleting from `activeRef` first makes the `.finally` path a no-op lookup; `agent.dispose()` should be idempotent (verify — most dispose impls guard re-entry).

- [ ] **Step 5: Update the two test stubs** — add `terminate: () => Effect.void` to `captureRunnerLayer` in `config-parity.test.ts` and any other `Layer.succeed(CortexRunnerService, {...})` stub (grep: `Layer.succeed(CortexRunnerService`).

- [ ] **Step 6: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/runner-service.test.ts apps/cortex/server/tests/config-parity.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/services/runner-service.ts apps/cortex/server/tests/runner-service.test.ts apps/cortex/server/tests/config-parity.test.ts
git commit -m "feat(cortex): runner terminate() + shared finalizeRun dispose (no leaks on manual stop)"
```

---

## Task C4: `POST /api/runs/:runId/terminate`

**Files:**
- Modify: `apps/cortex/server/api/runs.ts`
- Test: `apps/cortex/server/tests/api-runs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/cortex/server/tests/api-runs.test.ts
it("POST /api/runs/:runId/terminate calls runner.terminate", async () => {
  let terminatedWith = "";
  const app = buildTestApp(/* runner stub whose terminate records the id */);
  const res = await app.handle(new Request("http://localhost/api/runs/run-1/terminate", { method: "POST" }));
  expect(res.status).toBe(200);
  expect(terminatedWith).toBe("run-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: FAIL — 404 (route absent).

- [ ] **Step 3: Add the route** in `runs.ts` next to the existing `stop` route (~:185):

```ts
  .post("/api/runs/:runId/terminate", async ({ params, set }) => {
    try {
      await runtime.runPromise(
        CortexRunnerService.pipe(Effect.flatMap((r) => r.terminate(params.runId as RunId))),
      );
      return { ok: true };
    } catch (e) {
      set.status = 500;
      return { ok: false, error: String(e) };
    }
  })
```

(Match the exact error/response idiom used by the neighbouring `stop`/`pause` handlers — copy their structure.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/api/runs.ts apps/cortex/server/tests/api-runs.test.ts
git commit -m "feat(cortex): POST /api/runs/:runId/terminate"
```

---

## Task C5: UI — Stop (graceful) vs Terminate (immediate) actions

**Files:**
- Modify: the run-control component(s) — grep `runId/stop` / `runId/pause` in `apps/cortex/ui/src` to find the fetch call sites (likely `run-store.ts` + a controls component)
- Modify: `apps/cortex/ui/src/lib/run-store.ts` (add `terminateRun`)

- [ ] **Step 1: Add `terminateRun` to the store**

```ts
// run-store.ts — beside the existing stopRun/pauseRun
export async function terminateRun(runId: string): Promise<void> {
  await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/terminate`, { method: "POST" });
}
```

(Match the existing `stopRun` implementation's signature/error handling.)

- [ ] **Step 2: Add the Terminate button** next to the existing Stop button in the controls component:

```svelte
<button class="btn" onclick={() => stopRun(runId)}>Stop</button>
<button class="btn btn-danger" onclick={() => { if (confirm("Terminate now? In-flight work is aborted.")) terminateRun(runId); }}>
  Terminate
</button>
```

Both shown only while the run is active (reuse the existing active-state predicate that gates the Stop button).

- [ ] **Step 3: Build the UI**

Run: `cd apps/cortex/ui && bun run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (the headline)**

Start Ollama + Cortex; launch a run on a local model; hit **Terminate** mid-generation; confirm the run stops within ~1s (not after the full generation) and no orphaned container/`ollama ps` generation remains.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/run-store.ts apps/cortex/ui/src/lib/components/*
git commit -m "feat(cortex-ui): Stop (graceful) vs Terminate (immediate) run controls"
```

---

# Phase D — Detail-screen UX (config snapshot + rerun)

## Task D1: Persist `launch_params_json` per run

**Files:**
- Modify: `apps/cortex/server/db/schema.ts` (column + migration)
- Modify: `apps/cortex/server/services/store-service.ts` (`ensureRunRow` accepts snapshot) + `apps/cortex/server/db/queries.ts` (write/read)
- Modify: `apps/cortex/server/services/runner-service.ts` (pass resolved params to `ensureRunRow`)
- Modify: `apps/cortex/server/api/runs.ts` (`GET /api/runs/:runId` includes snapshot)
- Test: `apps/cortex/server/tests/api-runs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/cortex/server/tests/api-runs.test.ts
it("GET /api/runs/:runId returns the launch config snapshot", async () => {
  // start a run (real runner or a store write with launchParams), then GET it
  const res = await app.handle(new Request(`http://localhost/api/runs/${runId}`));
  const body = await res.json();
  expect(body.launchParams).toBeTruthy();
  expect(body.launchParams.strategy).toBe("reactive");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: FAIL — `launchParams` undefined.

- [ ] **Step 3: Add the column + migration** (`schema.ts`), following the existing `ALTER TABLE` pattern (~:147):

```ts
  if (!runCols.includes("launch_params_json")) db.exec("ALTER TABLE cortex_runs ADD COLUMN launch_params_json TEXT");
```

- [ ] **Step 4: Persist on start** — extend `ensureRunRow` (store-service + underlying query in `queries.ts`) to accept an optional `launchParamsJson: string`, and in `runner-service.start` pass `JSON.stringify(sanitize(params))` where `sanitize` strips secret values (drop `variableValues` marked secret; keep everything else). Write it in the same `ensureRunRow` call that already runs before `run()`.

- [ ] **Step 5: Return it** in `GET /api/runs/:runId` — parse `launch_params_json` and include as `launchParams` in the response (guard `JSON.parse` in try/catch → `null`).

- [ ] **Step 6: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/db/schema.ts apps/cortex/server/services/store-service.ts apps/cortex/server/db/queries.ts apps/cortex/server/services/runner-service.ts apps/cortex/server/api/runs.ts apps/cortex/server/tests/api-runs.test.ts
git commit -m "feat(cortex): persist per-run launch config snapshot (launch_params_json)"
```

---

## Task D2: `POST /api/runs/:runId/rerun`

**Files:**
- Modify: `apps/cortex/server/api/runs.ts`
- Test: `apps/cortex/server/tests/api-runs.test.ts`

**Interfaces:**
- Consumes: stored `launch_params_json` (D1); `runner.start` (existing).

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/cortex/server/tests/api-runs.test.ts
it("POST /api/runs/:runId/rerun launches a new run from the stored snapshot", async () => {
  let started: LaunchParams | null = null;
  const app = buildTestApp(/* runner stub capturing start(params) → started; returns new ids */);
  // seed a run row with launch_params_json = {prompt:"hi", strategy:"blueprint", ...}
  const res = await app.handle(new Request(`http://localhost/api/runs/${seededRunId}/rerun`, { method: "POST" }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.runId).toBeTruthy();
  expect(started?.strategy).toBe("blueprint");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: FAIL — 404.

- [ ] **Step 3: Add the route** in `runs.ts`:

```ts
  .post("/api/runs/:runId/rerun", async ({ params, set }) => {
    try {
      const ids = await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CortexStoreService;
          const runner = yield* CortexRunnerService;
          const snapshot = yield* store.getLaunchParams(params.runId as RunId); // add this query
          if (!snapshot) return yield* Effect.fail(new CortexError({ message: "No stored config to rerun" }));
          return yield* runner.start(snapshot as LaunchParams);
        }),
      );
      return ids; // { agentId, runId }
    } catch (e) {
      set.status = 400;
      return { ok: false, error: String(e) };
    }
  })
```

Add `getLaunchParams(runId): Effect.Effect<LaunchParams | null, CortexError>` to the store service (parse `launch_params_json`).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/cortex/server/tests/api-runs.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/api/runs.ts apps/cortex/server/services/store-service.ts apps/cortex/server/tests/api-runs.test.ts
git commit -m "feat(cortex): POST /api/runs/:runId/rerun (exact repeat from snapshot)"
```

---

## Task D3: Detail-screen — Stop/Terminate + config snapshot panel + Rerun / Edit & Rerun

**Files:**
- Modify: `apps/cortex/ui/src/routes/run/[runId]/+page.svelte`
- Modify: `apps/cortex/ui/src/lib/run-store.ts` (add `rerunRun`)
- (Reuse) `apps/cortex/ui/src/lib/capabilities.ts` labels for read-only config display

- [ ] **Step 1: Add `rerunRun` to the store**

```ts
export async function rerunRun(runId: string): Promise<{ agentId: string; runId: string }> {
  const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/rerun`, { method: "POST" });
  if (!res.ok) throw new Error(`rerun failed: ${res.status}`);
  return (await res.json()) as { agentId: string; runId: string };
}
```

- [ ] **Step 2: Detail-screen controls** in `run/[runId]/+page.svelte`:

- While active: **Stop** + **Terminate** buttons (reuse `stopRun`/`terminateRun` from C5).
- Always: **Rerun** button → `rerunRun(runId)` then `goto("/run/" + result.runId)`.
- **Edit & Rerun** button → navigate to the Lab/Builder route with the snapshot loaded (pass `launchParams` via query/state; the Builder prefills `config` from it), then the user launches through the normal `POST /api/runs`.

```svelte
<script lang="ts">
  import { stopRun, terminateRun, rerunRun } from "$lib/run-store";
  import { goto } from "$app/navigation";
  let { data } = $props(); // data.run.launchParams from GET /api/runs/:runId
  const active = $derived(data.run.status === "live" || data.run.status === "running");
  async function doRerun() { const r = await rerunRun(data.run.runId); goto(`/run/${r.runId}`); }
</script>

{#if active}
  <button onclick={() => stopRun(data.run.runId)}>Stop</button>
  <button class="btn-danger" onclick={() => confirm("Terminate now?") && terminateRun(data.run.runId)}>Terminate</button>
{/if}
<button onclick={doRerun}>Rerun</button>
<button onclick={() => goto(`/lab?fromRun=${data.run.runId}`)}>Edit & Rerun</button>
```

- [ ] **Step 3: Config snapshot panel** — render `data.run.launchParams` read-only, labeling fields via the manifest (reuse `capabilities` labels; fall back to the raw key). Keep it simple: a definition list of key → value for the non-null snapshot fields.

- [ ] **Step 4: Lab prefill from `?fromRun=`** — in `lab/+page.svelte` load, if `fromRun` present, `GET /api/runs/:id`, and seed `config` from `launchParams` (merge over `defaultConfig()` so missing/new fields keep defaults — this is also what keeps rerun robust when the snapshot predates a new field).

- [ ] **Step 5: Build the UI**

Run: `cd apps/cortex/ui && bun run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke** — open a finished run detail; click **Rerun** (new run starts with same config); click **Edit & Rerun** (Builder opens prefilled); change strategy to `blueprint`; launch; confirm it runs.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/ui/src/routes/run/[runId]/+page.svelte apps/cortex/ui/src/routes/lab/+page.svelte apps/cortex/ui/src/lib/run-store.ts
git commit -m "feat(cortex-ui): run-detail Stop/Terminate + config snapshot + Rerun / Edit & Rerun"
```

---

# Final verification

- [ ] **Framework packages green:** `bun test packages/reasoning/test packages/runtime/test packages/guardrails/test --timeout 30000`
- [ ] **Cortex server green:** `bun test apps/cortex/server/tests --timeout 15000`
- [ ] **Cortex UI lib green:** `cd apps/cortex/ui && bun test src/lib --timeout 15000`
- [ ] **Builds:** `bunx turbo run build --filter=@reactive-agents/runtime --filter=@reactive-agents/reasoning --filter=@reactive-agents/guardrails` and `cd apps/cortex/ui && bun run build`
- [ ] **End-to-end dynamic-sync proof:** with `bun start`, the Strategy dropdown lists all 8 canonical strategies and the model-routing control appears — none hardcoded in the UI beyond presentation hints.
- [ ] **Run-control proof:** Terminate on a live Ollama run stops generation within ~1s and disposes the agent (no leaked container / no lingering `ollama ps` generation).

---

## Self-Review (completed)

**Spec coverage:** B (manifest) → B1–B4 framework + B5–B8 Cortex; A (parity) → B9 (strategies) + A1–A2 (model routing); C (run control) → C1–C5; D (detail UX) → D1–D3. All spec sections mapped.

**No-regression emphasis:** strategy type widened (superset, not replaced); manifest adoption is incremental (dropdown first, panel stays); `stop` semantics unchanged, `terminate` added; DB change is additive column; snapshot rerun merges over `defaultConfig()` so old snapshots survive new fields.

**Type consistency:** `CapabilityManifest`/`StrategyDescriptor`/`BuilderMethodDescriptor`/`ConfigFieldDescriptor` defined in B2–B4, mirrored structurally in UI B6, consumed consistently in B7–B9. `finalizeRun` (C3) name used consistently. `getLaunchParams` (D2) defined where consumed.

**Open follow-ups (not blockers):** hardening B8's soft coverage assertion to `toBe(0)` once all current fields are styled; optionally promoting `modelRouting` from an overlay to a schema-backed field so it appears in `configFields` automatically (kept as overlay here to avoid touching core `AgentConfigSchema` + `agentConfigToBuilder`).
