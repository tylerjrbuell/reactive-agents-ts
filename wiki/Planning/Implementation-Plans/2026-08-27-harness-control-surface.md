---
aliases: [Harness Control Surface, W3 Plan]
tags: [plan, harness, dx, context-profile, w3]
date: 2026-08-27
status: READY
spec: "wiki/Decisions/2026-08-24-external-research-convergence-amendment.md"
---

# Harness Control Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every harness mechanism configurable per-agent through a typed public API, with environment variables demoted to a fallback layer, so two agents in one process can run different harness configurations and a sub-agent inherits its parent's.

**Architecture:** One `ResolvedHarness` object is resolved ONCE per run (config → env → default, in that precedence) and carried on the existing `RunEnvelope` service as a third named sub-record. Call sites read `input.harness.<field>` instead of calling a zero-argument env resolver. The 15 resolvers in `harness-flags.ts` survive unchanged in name and behaviour as the *environment layer* of that resolution — which keeps `scripts/check-ablatable.sh` green and keeps back-compat exact.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS (`Context.Tag`, `Layer`), Bun test runner, Effect `Schema` for the JSON-serialisable config row.

**Spec:** `wiki/Decisions/2026-08-24-external-research-convergence-amendment.md` §4 W3 (F-4 is the specific finding; this plan widens W3's scope from "wire or delete `toolDisclosureMode`" to "give the mechanisms a config surface at all", on the evidence in the Background section below).

## Background — the decisive signals (verified 2026-08-27)

1. `packages/reasoning/src/harness-flags.ts` exports **15 resolvers** gating disclosure, discovery, tool index, verbose rules, stable tool surface, context budgets, thought continuity, observe symmetry, rationale audit, ToT explore budget, and two debug knobs.
2. Every one resolves through `readFlag(name)` → `process.env[name]`, read **at the call site**, inside plain synchronous functions. There is no config parameter anywhere in the chain.
3. The builder exposes **80 `with*` methods**. None reaches any of these mechanisms.
4. `grep` for the three most load-bearing flags across `apps/docs/src`, `README.md`, and `.env.example`: **zero hits**. They are undocumented.
5. Consequence — **process-global**: two agents in one process cannot hold different harness configs, and `scripts/check-cross-cutting.sh` check 5/10 (sub-agents inherit the parent's cross-cutting policy) has no harness field to thread.
6. `packages/reasoning/src/context/context-profile.ts:93` declares `toolDisclosureMode` with 25 lines of JSDoc and **zero consumers** (finding F-4). It cannot be wired because there is nothing to wire it *to*.
7. **The template already exists and is shipped.** `auditRationale` is config-first with an env override: `.withReasoning({ auditRationale })` → `ReasoningOptionsJsonSchema` → `AgentConfig` → `KernelInput.auditRationale` → `think.ts:844` reads `input.auditRationale === true || rationaleAuditEnabled()`. This plan generalises that one proven pattern to the other 14 — but as ONE object rather than 15 hand-threaded fields, because hand-threading run-wide fields through strategy interfaces is a defect class this repo has already paid for (see `run-envelope.ts` header: grounding/fabricationGuard/stallPolicy were silently dropped on 5 of 8 strategies).

## Global Constraints

- **Strict TypeScript. No `any` casts.** Use `unknown` plus type guards. The repo has an `as unknown as` ceiling gate — do not raise it.
- **Zero behaviour change when no harness config is supplied.** With every field absent, resolution must return exactly what the env resolvers return today. This is the same absent-field discipline `buildRunEnvelope` already documents: use conditional spread, never `?? undefined`.
- **Precedence is fixed: explicit config > environment variable > built-in default.** Never the reverse. An env var must not override an explicit programmatic choice.
- **`scripts/check-ablatable.sh` must stay green.** It fails on any `process.env.RA_` read outside a named resolver. Do not add env reads at call sites; the resolvers in `harness-flags.ts` remain the only env readers.
- **`scripts/check-cross-cutting.sh` must stay green — all 10 checks.**
- **No `Co-Authored-By` or `Claude-Session` trailers in commit messages.** Hard project rule.
- Verification command for the whole suite: `bun test --timeout 60000`. Build: `bunx turbo run build`. Gates: `./scripts/check-cross-cutting.sh`.
- Commit after every task. Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Plans, specs, decisions, debriefs go under `wiki/` — never `docs/`.

## File Structure

**Created:**
- `packages/reasoning/src/harness-config.ts` — the `HarnessConfig` (all-optional, user-facing) and `ResolvedHarness` (all-present, internal) types plus `resolveHarnessConfig()`. Single responsibility: turn optional config + environment into one frozen resolved record.
- `packages/reasoning/src/harness-config.test.ts` — precedence and absent-field tests.
- `packages/runtime/src/harness-schema.ts` — the Effect `Schema` row for the JSON-serialisable subset, mirroring `reasoning-options-schema.ts`.
- `packages/reasoning/tests/kernel/harness-config-threading.test.ts` — proves the resolved object reaches the call sites.
- `scripts/check-harness-config.sh` — red-on-cut gate: no call site may import a `harness-flags.ts` resolver directly.

**Modified:**
- `packages/reasoning/src/kernel/envelope/run-envelope.ts` — third sub-record `harness`.
- `packages/reasoning/src/kernel/state/kernel-state.ts` — `KernelInput.harness`.
- `packages/reasoning/src/kernel/state/build-kernel-input.ts` — passthrough key.
- Nine call-site files (Task 3 lists each with its line).
- `packages/runtime/src/builder.ts` — `.withHarness()`.
- `packages/runtime/src/builder/build-effect/sub-agent-executor.ts` — `parentHarness`.
- `scripts/check-cross-cutting.sh` — add `harness` to check 5's inherited-field list; add check 11 delegating to `check-harness-config.sh`.
- `.env.example`, `apps/docs/src/content/docs/` — documentation.

---

### Task 1: The resolved harness config

**Files:**
- Create: `packages/reasoning/src/harness-config.ts`
- Create: `packages/reasoning/src/harness-config.test.ts`
- Modify: `packages/reasoning/src/index.ts` (export the new types + function)

**Interfaces:**
- Consumes: the 15 existing resolvers from `packages/reasoning/src/harness-flags.ts` — `lazyDisclosureEnabled()`, `toolDiscoveryEnabled()`, `toolIndexEnabled()`, `toolIndexMaxEntriesFlag()`, `verboseRulesEnabled()`, `stableToolSurfaceEnabled()`, `recencyBudgetCharsOverride()`, `toolResultBudgetCharsOverride()`, `thoughtContinuityEnabled()`, `toolObserveSymmetryEnabled()`, `rationaleAuditEnabled()`, `treeOfThoughtExploreBudgetMs()`, `assemblyDebugEnabled()`, `promptDumpPathPrefix()`, `overhaulEnabled()`.
- Produces: `type HarnessConfig` (all fields optional), `type ResolvedHarness` (booleans/numbers present, `number | undefined` and `string | undefined` fields stay optional), and `resolveHarnessConfig(config?: HarnessConfig): ResolvedHarness`. Tasks 2–6 all consume these three names.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/src/harness-config.test.ts`:

```ts
import { describe, expect, it, afterEach } from "bun:test";
import { resolveHarnessConfig } from "./harness-config.js";

const ENV_KEYS = [
  "RA_LAZY_TOOLS", "RA_TOOL_DISCOVERY", "RA_TOOL_INDEX", "RA_VERBOSE_RULES",
  "RA_STABLE_TOOL_SURFACE", "RA_THOUGHT_CONTINUITY", "RA_RECENCY_BUDGET_CHARS",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("resolveHarnessConfig — precedence", () => {
  it("uses the built-in default when neither config nor env is set", () => {
    const r = resolveHarnessConfig();
    expect(r.lazyDisclosure).toBe(true);
    expect(r.stableToolSurface).toBe(false);
    expect(r.toolIndex).toBe(false);
  });

  it("lets the environment override the built-in default", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    expect(resolveHarnessConfig().stableToolSurface).toBe(true);
  });

  it("lets explicit config beat the environment — config always wins", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    expect(resolveHarnessConfig({ stableToolSurface: false }).stableToolSurface).toBe(false);
    process.env.RA_LAZY_TOOLS = "0";
    expect(resolveHarnessConfig({ lazyDisclosure: true }).lazyDisclosure).toBe(true);
  });

  it("treats an explicit `false` as a real choice, not as absent", () => {
    expect(resolveHarnessConfig({ lazyDisclosure: false }).lazyDisclosure).toBe(false);
  });

  it("omits optional numeric overrides entirely when nothing sets them", () => {
    const r = resolveHarnessConfig();
    expect("recencyBudgetChars" in r).toBe(false);
    expect("toolIndexMaxEntries" in r).toBe(false);
  });

  it("carries a numeric override from config", () => {
    expect(resolveHarnessConfig({ recencyBudgetChars: 4096 }).recencyBudgetChars).toBe(4096);
  });

  it("is frozen — a run cannot mutate its own harness config", () => {
    const r = resolveHarnessConfig();
    expect(Object.isFrozen(r)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/harness-config.test.ts`
Expected: FAIL — `Cannot find module './harness-config.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/reasoning/src/harness-config.ts`:

```ts
/**
 * HarnessConfig — the typed, per-agent control surface for harness mechanisms.
 *
 * WHY THIS EXISTS. Every mechanism below was previously reachable ONLY through
 * a process-global environment variable read at the call site
 * (`harness-flags.ts`). That made the harness un-configurable from code, absent
 * from the 80-method builder surface, undocumented, and — the load-bearing
 * defect — process-global, so two agents in one process could not differ and a
 * sub-agent could not inherit anything.
 *
 * PRECEDENCE IS FIXED: explicit config > environment variable > built-in
 * default. An env var never overrides a programmatic choice; it only fills a
 * hole. The env layer is `harness-flags.ts`, which remains the ONLY place in
 * `packages/reasoning` that reads `process.env.RA_*` (gate:
 * scripts/check-ablatable.sh).
 *
 * ABSENT-FIELD DISCIPLINE. Fields whose "unset" state is meaningful
 * (`recencyBudgetChars`, `toolResultBudgetChars`, `toolIndexMaxEntries`,
 * `promptDumpPathPrefix`) are written with a conditional spread and are absent
 * — not `undefined` — when nothing sets them, so `"x" in resolved` still
 * distinguishes "no override" from "override of 0". Same rule as
 * `buildRunEnvelope`.
 */
import {
  lazyDisclosureEnabled,
  toolDiscoveryEnabled,
  toolIndexEnabled,
  toolIndexMaxEntriesFlag,
  verboseRulesEnabled,
  stableToolSurfaceEnabled,
  recencyBudgetCharsOverride,
  toolResultBudgetCharsOverride,
  thoughtContinuityEnabled,
  toolObserveSymmetryEnabled,
  rationaleAuditEnabled,
  treeOfThoughtExploreBudgetMs,
  assemblyDebugEnabled,
  promptDumpPathPrefix,
} from "./harness-flags.js";

/** User-facing shape: every field optional, absent means "do not decide". */
export interface HarnessConfig {
  /** Per-iteration lazy tool disclosure. Default ON. (`RA_LAZY_TOOLS=0`) */
  readonly lazyDisclosure?: boolean;
  /** Register the `discover-tools` meta-tool. Default follows `lazyDisclosure`. (`RA_TOOL_DISCOVERY`) */
  readonly toolDiscovery?: boolean;
  /** Render a cheap name+one-line index of the hidden tool set. Default OFF. (`RA_TOOL_INDEX`) */
  readonly toolIndex?: boolean;
  /** Cap on entries in that index. Unset ⇒ the tier profile decides. (`RA_TOOL_INDEX_MAX_ENTRIES`) */
  readonly toolIndexMaxEntries?: number;
  /** Inject the verbose ReAct RULES block. Default OFF. (`RA_VERBOSE_RULES`) */
  readonly verboseRules?: boolean;
  /** Keep the function-calling tool array byte-stable across iterations so the
   *  provider's prompt cache survives. Default OFF. (`RA_STABLE_TOOL_SURFACE`) */
  readonly stableToolSurface?: boolean;
  /** Character budget for recent observations. Unset ⇒ derived from the window. (`RA_RECENCY_BUDGET_CHARS`) */
  readonly recencyBudgetChars?: number;
  /** Per-tool-result preservation cap. Unset ⇒ the tier table decides. (`RA_TOOL_RESULT_BUDGET_CHARS`) */
  readonly toolResultBudgetChars?: number;
  /** Carry thought continuity across projected results. Default OFF. (`RA_THOUGHT_CONTINUITY`) */
  readonly thoughtContinuity?: boolean;
  /** Symmetric observe formatting on tool results. Default OFF. (`RA_TOOL_OBSERVE_SYMMETRY`) */
  readonly toolObserveSymmetry?: boolean;
  /** Emit a per-tool-call rationale block for audit. Default OFF — an AUDIT
   *  feature, measured as a pure speed/token tax. (`RA_RATIONALE_AUDIT`) */
  readonly auditRationale?: boolean;
  /** Tree-of-Thought exploration budget in milliseconds. Default 120000. (`RA_TOT_EXPLORE_BUDGET_MS`) */
  readonly treeOfThoughtExploreBudgetMs?: number;
  /** Verbose assembly-stage diagnostics. Debug only. (`RA_ASSEMBLY_DEBUG`) */
  readonly assemblyDebug?: boolean;
  /** Write each rendered prompt to `<prefix>-<n>.txt`. Debug only. (`RA_PROMPT_DUMP`) */
  readonly promptDumpPathPrefix?: string;
}

/** Internal shape: booleans and always-defaulted numbers are present; genuinely
 *  optional overrides stay optional so "absent" survives the round trip. */
export interface ResolvedHarness {
  readonly lazyDisclosure: boolean;
  readonly toolDiscovery: boolean;
  readonly toolIndex: boolean;
  readonly toolIndexMaxEntries?: number;
  readonly verboseRules: boolean;
  readonly stableToolSurface: boolean;
  readonly recencyBudgetChars?: number;
  readonly toolResultBudgetChars?: number;
  readonly thoughtContinuity: boolean;
  readonly toolObserveSymmetry: boolean;
  readonly auditRationale: boolean;
  readonly treeOfThoughtExploreBudgetMs: number;
  readonly assemblyDebug: boolean;
  readonly promptDumpPathPrefix?: string;
}

/** `config ?? env ?? default`, for a field whose env layer already folds in its default. */
function pick(configured: boolean | undefined, fromEnv: boolean): boolean {
  return configured !== undefined ? configured : fromEnv;
}

/** `config ?? env`, for a field where ABSENT is a meaningful third state. */
function pickOptional<T>(configured: T | undefined, fromEnv: T | undefined): T | undefined {
  return configured !== undefined ? configured : fromEnv;
}

/**
 * Resolve the harness config ONCE per run. Call this at the runtime boundary,
 * never at a call site — a call site that re-resolves reintroduces the
 * process-global read this type exists to remove.
 */
export function resolveHarnessConfig(config: HarnessConfig = {}): ResolvedHarness {
  const toolIndexMaxEntries = pickOptional(config.toolIndexMaxEntries, toolIndexMaxEntriesFlag());
  const recencyBudgetChars = pickOptional(config.recencyBudgetChars, recencyBudgetCharsOverride());
  const toolResultBudgetChars = pickOptional(
    config.toolResultBudgetChars,
    toolResultBudgetCharsOverride(),
  );
  const promptDump = pickOptional(config.promptDumpPathPrefix, promptDumpPathPrefix());

  return Object.freeze({
    lazyDisclosure: pick(config.lazyDisclosure, lazyDisclosureEnabled()),
    toolDiscovery: pick(config.toolDiscovery, toolDiscoveryEnabled()),
    toolIndex: pick(config.toolIndex, toolIndexEnabled()),
    ...(toolIndexMaxEntries !== undefined ? { toolIndexMaxEntries } : {}),
    verboseRules: pick(config.verboseRules, verboseRulesEnabled()),
    stableToolSurface: pick(config.stableToolSurface, stableToolSurfaceEnabled()),
    ...(recencyBudgetChars !== undefined ? { recencyBudgetChars } : {}),
    ...(toolResultBudgetChars !== undefined ? { toolResultBudgetChars } : {}),
    thoughtContinuity: pick(config.thoughtContinuity, thoughtContinuityEnabled()),
    toolObserveSymmetry: pick(config.toolObserveSymmetry, toolObserveSymmetryEnabled()),
    auditRationale: pick(config.auditRationale, rationaleAuditEnabled()),
    treeOfThoughtExploreBudgetMs:
      config.treeOfThoughtExploreBudgetMs ?? treeOfThoughtExploreBudgetMs(),
    assemblyDebug: pick(config.assemblyDebug, assemblyDebugEnabled()),
    ...(promptDump !== undefined ? { promptDumpPathPrefix: promptDump } : {}),
  });
}

/** The no-config resolution — byte-identical to today's env-only behaviour. */
export const defaultResolvedHarness = (): ResolvedHarness => resolveHarnessConfig();
```

- [ ] **Step 4: Export from the package index**

In `packages/reasoning/src/index.ts`, beside the existing `RunEnvelope` export block, add:

```ts
// ─── HarnessConfig — the typed per-agent harness control surface (W3) ───
export { resolveHarnessConfig, defaultResolvedHarness } from "./harness-config.js";
export type { HarnessConfig, ResolvedHarness } from "./harness-config.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/reasoning/src/harness-config.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/harness-config.ts packages/reasoning/src/harness-config.test.ts packages/reasoning/src/index.ts
git commit -m "feat(reasoning): typed harness config with config>env>default precedence"
```

---

### Task 2: Carry the resolved harness on the RunEnvelope

**Files:**
- Modify: `packages/reasoning/src/kernel/envelope/run-envelope.ts`
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (add `KernelInput.harness`)
- Modify: `packages/reasoning/src/kernel/state/build-kernel-input.ts` (add `"harness"` to the passthrough key union at line 64's list)
- Test: `packages/reasoning/src/kernel/envelope/run-envelope.test.ts` (extend)

**Interfaces:**
- Consumes: `ResolvedHarness`, `resolveHarnessConfig` from Task 1.
- Produces: `RunEnvelopeData.harness: ResolvedHarness`, `BuildRunEnvelopeOptions.harness?: HarnessConfig`, and `KernelInput.harness?: ResolvedHarness`. Task 3 reads `input.harness`; Task 5 sets `BuildRunEnvelopeOptions.harness`.

**Why the envelope and not 15 threaded fields:** `run-envelope.ts`'s own header records the defect class — "a run-wide field threaded by hand through 8 strategy input interfaces is silently dropped wherever an interface omits it (grounding/fabricationGuard/stallPolicy discarded on 5 of 8 strategies, measured 2026-07-22)". Fifteen new hand-threaded fields would re-buy that defect fifteen times. One object on the existing carrier cannot be dropped at a join, because strategies never carry it.

- [ ] **Step 1: Write the failing test**

Append to `packages/reasoning/src/kernel/envelope/run-envelope.test.ts`:

```ts
describe("RunEnvelope — harness sub-record", () => {
  it("always carries a resolved harness, even with no options", () => {
    const env = buildRunEnvelope();
    expect(env.harness.lazyDisclosure).toBe(true);
    expect(Object.isFrozen(env.harness)).toBe(true);
  });

  it("resolves the caller's harness config into the envelope", () => {
    const env = buildRunEnvelope({ harness: { stableToolSurface: true } });
    expect(env.harness.stableToolSurface).toBe(true);
  });

  it("folds the harness into a KernelInput that does not already carry one", () => {
    const env = buildRunEnvelope({ harness: { toolIndex: true } });
    const folded = mergeRunEnvelopeIntoKernelInput({ task: "t" } as KernelInput, env);
    expect(folded.harness?.toolIndex).toBe(true);
  });

  it("never overwrites an explicit KernelInput.harness — per-pass override wins", () => {
    const env = buildRunEnvelope({ harness: { toolIndex: true } });
    const explicit = resolveHarnessConfig({ toolIndex: false });
    const folded = mergeRunEnvelopeIntoKernelInput(
      { task: "t", harness: explicit } as KernelInput,
      env,
    );
    expect(folded.harness?.toolIndex).toBe(false);
  });
});
```

Add the imports the new block needs at the top of that test file: `resolveHarnessConfig` from `../../harness-config.js` and, if not already imported, `mergeRunEnvelopeIntoKernelInput` and `type KernelInput`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/kernel/envelope/run-envelope.test.ts`
Expected: FAIL — `env.harness` is `undefined`.

- [ ] **Step 3: Add the sub-record**

In `packages/reasoning/src/kernel/envelope/run-envelope.ts`:

Add the import:

```ts
import { resolveHarnessConfig, type HarnessConfig, type ResolvedHarness } from "../../harness-config.js";
```

Extend `RunEnvelopeData` (note: `harness` is REQUIRED, unlike `policy`/`rails` members — there is always a resolution, because "no config" is itself a valid resolution):

```ts
export interface RunEnvelopeData {
  readonly policy: RunEnvelopePolicy;
  readonly rails: RunEnvelopeRails;
  /**
   * Harness mechanism configuration, resolved once (config > env > default).
   * A THIRD named sub-record on the SAME service — never a second service.
   * Spec §9's ruling stands: splitting the carrier reinvents the drop at the
   * join. `policy` is judgment, `rails` is repair, `harness` is mechanism.
   */
  readonly harness: ResolvedHarness;
}
```

Extend `BuildRunEnvelopeOptions`:

```ts
  /** Optional per-agent harness config; absent ⇒ pure env/default resolution. */
  readonly harness?: HarnessConfig;
```

In `buildRunEnvelope`, add as a sibling of `policy` and `rails`:

```ts
    harness: resolveHarnessConfig(opts.harness ?? {}),
```

Update `emptyRunEnvelope`:

```ts
/** The no-config envelope: every policy/rails field absent, harness fully
 *  resolved from env+defaults. Zero behavior change by construction. */
export const emptyRunEnvelope: RunEnvelopeData = {
  policy: {},
  rails: {},
  harness: resolveHarnessConfig(),
};
```

In `mergeRunEnvelopeIntoKernelInput`, add to the merge, following the file's existing conditional-spread discipline (an explicit `KernelInput` field always wins):

```ts
    ...(input.harness === undefined ? { harness: envelope.harness } : {}),
```

- [ ] **Step 4: Add the KernelInput field**

In `packages/reasoning/src/kernel/state/kernel-state.ts`, beside the existing `auditRationale` declaration (~line 788):

```ts
  /**
   * Resolved harness mechanism config for this pass (W3). Folded in from the
   * RunEnvelope by `runKernel`; an explicit value here wins, so a sub-kernel
   * can be handed a narrower harness than the run's.
   */
  readonly harness?: import("../../harness-config.js").ResolvedHarness;
```

In `packages/reasoning/src/kernel/state/build-kernel-input.ts`, add `| "harness"` to the passthrough key union alongside `| "auditRationale"` (line 64).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/reasoning/src/kernel/envelope/ packages/reasoning/src/kernel/state/`
Expected: PASS, including the four new cases.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/
git commit -m "feat(reasoning): carry the resolved harness config on the RunEnvelope"
```

---

### Task 3: Migrate the nineteen call sites to read the carried config

**Files (exact sites, verified 2026-08-27):**
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts` — `lazyDisclosureEnabled()` ×1, `toolIndexEnabled()` ×2 (lines 870, 957), `toolIndexMaxEntriesFlag()` ×2 (lines 874, 936), `rationaleAuditEnabled()` ×1 (line 845), `assemblyDebugEnabled()` ×1, `promptDumpPathPrefix()` ×1
- Modify: `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts:285` — `stableToolSurfaceEnabled()`
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-capabilities.ts` — `toolDiscoveryEnabled()` ×2
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` — `toolObserveSymmetryEnabled()`
- Modify: `packages/reasoning/src/assembly/capability.ts:67,76` — `recencyBudgetCharsOverride()`, `toolResultBudgetCharsOverride()`
- Modify: `packages/reasoning/src/assembly/stages/system-prompt.ts:97` — `verboseRulesEnabled()`
- Modify: `packages/reasoning/src/assembly/stages/project-results.ts` — `thoughtContinuityEnabled()`
- Modify: `packages/reasoning/src/strategies/plan-execute.ts:372` — `rationaleAuditEnabled()`
- Modify: `packages/reasoning/src/strategies/tree-of-thought.ts` — `treeOfThoughtExploreBudgetMs()`
- Test: `packages/reasoning/tests/kernel/harness-config-threading.test.ts` (create)

**Interfaces:**
- Consumes: `KernelInput.harness` (Task 2), `ResolvedHarness` (Task 1).
- Produces: `ToolSurfaceInputs.harness: ResolvedHarness` and `CapabilityInput.harness?: ResolvedHarness` — two existing input records gain the field so the two non-kernel call-site clusters can read it. No other signature changes.

**Migration rule for every site:** replace the zero-argument resolver call with a read off the carried object. Where a site is reached from `think.ts`, thread `input.harness` into the existing input record it already builds — do NOT add a new parameter to a function that already takes an inputs object.

**Fallback rule (important):** each site keeps working when `harness` is absent, because a pass may be constructed without an envelope. Use `const h = input.harness ?? resolveHarnessConfig();` once at the top of the function, then read `h.<field>`. Resolving once per call is still strictly better than the status quo (a raw `process.env` read per site) and it disappears entirely once every constructor folds the envelope.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/tests/kernel/harness-config-threading.test.ts`:

```ts
import { describe, expect, it, afterEach } from "bun:test";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { resolveToolSurface, type ToolSurfaceInputs } from "../../src/kernel/capabilities/reason/tool-surface.js";
import { resolveCapability } from "../../src/assembly/capability.js";

afterEach(() => {
  delete process.env.RA_STABLE_TOOL_SURFACE;
  delete process.env.RA_RECENCY_BUDGET_CHARS;
});

const schema = (name: string) => ({ name, description: name, parameters: {} });

function baseSurfaceInputs(harness = resolveHarnessConfig()): ToolSurfaceInputs {
  return {
    augmented: [schema("file-read"), schema("file-write"), schema("web-search")],
    finalAnswerSchema: schema("final-answer"),
    lazyMode: true,
    pressureCritical: false,
    hasClassification: false,
    requiredTools: [],
    relevantTools: ["file-read"],
    allowedTools: ["file-read", "file-write", "web-search"],
    toolsUsed: [],
    discovered: [],
    gateBlockedTools: [],
    missingRequiredTools: [],
    pruneMinTools: 1,
    harness,
  } as ToolSurfaceInputs;
}

describe("harness config reaches the call sites", () => {
  it("stable tool surface follows the CARRIED config, not the environment", () => {
    // Environment says off; carried config says on. Config must win.
    delete process.env.RA_STABLE_TOOL_SURFACE;
    const on = resolveToolSurface(baseSurfaceInputs(resolveHarnessConfig({ stableToolSurface: true })));
    expect(on.visible.length).toBe(3);

    // Environment says on; carried config says off. Config must still win.
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const off = resolveToolSurface(baseSurfaceInputs(resolveHarnessConfig({ stableToolSurface: false })));
    expect(off.visible.length).toBeLessThan(3);
  });

  it("the recency budget follows the carried config over the environment", () => {
    process.env.RA_RECENCY_BUDGET_CHARS = "999";
    const r = resolveCapability({
      tier: "mid",
      window: 32_000,
      harness: resolveHarnessConfig({ recencyBudgetChars: 4096 }),
    } as Parameters<typeof resolveCapability>[0]);
    expect(r.recencyBudgetChars).toBe(4096);
  });
});
```

Adjust the two import paths and the `resolveToolSurface` / `resolveCapability` names only if they differ from the exports those files actually carry — read each file's export line before writing the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/tests/kernel/harness-config-threading.test.ts`
Expected: FAIL — `harness` is not a property of `ToolSurfaceInputs` / `CapabilityInput` (TypeScript error), and the assertions do not hold.

- [ ] **Step 3: Add the field to the two input records**

In `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts`, add to `ToolSurfaceInputs` (after `pruneMinTools` at line 168):

```ts
  /** Resolved harness config for this run — the ONLY source for mechanism
   *  switches at this site. Threaded from `KernelInput.harness` by think.ts. */
  readonly harness: ResolvedHarness;
```

Import `ResolvedHarness` from `../../../harness-config.js`, and replace line 285's condition:

```ts
  if (inputs.harness.stableToolSurface) {
```

In `packages/reasoning/src/assembly/capability.ts`, add to `CapabilityInput`:

```ts
  /** Resolved harness config; absent ⇒ env/default resolution (see Task 3 fallback rule). */
  readonly harness?: ResolvedHarness;
```

and replace lines 67 and 76:

```ts
  const h = input.harness ?? resolveHarnessConfig();
  const envRecency = h.recencyBudgetChars;
  // ...
  const envPreserve = h.toolResultBudgetChars;
```

Remove the now-unused `recencyBudgetCharsOverride` / `toolResultBudgetCharsOverride` imports from that file.

- [ ] **Step 4: Migrate the remaining seven files**

In each, add `const h = <inputRecord>.harness ?? resolveHarnessConfig();` near the top of the function and substitute:

| File | Was | Becomes |
|---|---|---|
| `think.ts:845` | `input.auditRationale === true \|\| rationaleAuditEnabled()` | `input.auditRationale === true \|\| h.auditRationale` |
| `think.ts:870,957` | `toolIndexEnabled()` | `h.toolIndex` |
| `think.ts:874,936` | `toolIndexMaxEntriesFlag()` | `h.toolIndexMaxEntries` |
| `think.ts` (lazy) | `lazyDisclosureEnabled()` | `h.lazyDisclosure` |
| `think.ts` (debug) | `assemblyDebugEnabled()` / `promptDumpPathPrefix()` | `h.assemblyDebug` / `h.promptDumpPathPrefix` |
| `tool-capabilities.ts` ×2 | `toolDiscoveryEnabled()` | `h.toolDiscovery` |
| `act.ts` | `toolObserveSymmetryEnabled()` | `h.toolObserveSymmetry` |
| `system-prompt.ts:97` | `verboseRulesEnabled()` | `h.verboseRules` |
| `project-results.ts` | `thoughtContinuityEnabled()` | `h.thoughtContinuity` |
| `plan-execute.ts:372` | `rationaleAuditEnabled()` | `h.auditRationale` |
| `tree-of-thought.ts` | `treeOfThoughtExploreBudgetMs()` | `h.treeOfThoughtExploreBudgetMs` |

`think.ts` must also pass `harness: h` into the `ToolSurfaceInputs` object it builds for `tool-surface.ts`, and into the assembly `CapabilityInput` if it constructs one. `system-prompt.ts` and `project-results.ts` receive a context object (`c`) — add `readonly harness?: ResolvedHarness` to that context type and populate it from the caller in `think.ts` / the assembly pipeline.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/reasoning/`
Expected: PASS. If a pre-existing test set an `RA_*` variable and now sees config win, that test is asserting the OLD precedence — update it to set the config instead, and note the change in the commit body.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src packages/reasoning/tests
git commit -m "refactor(reasoning): read harness mechanisms from the carried config, not process.env"
```

---

### Task 4: `.withHarness()` — the public builder surface

**Files:**
- Create: `packages/runtime/src/harness-schema.ts`
- Modify: `packages/runtime/src/reasoning-options-schema.ts` (add the `harness` field)
- Modify: `packages/runtime/src/builder.ts` (add `.withHarness()`)
- Modify: `packages/runtime/src/builder/to-config.ts` (serialise it)
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` (pass it into `buildRunEnvelope`)
- Test: `packages/runtime/src/harness-builder.test.ts` (create)

**Interfaces:**
- Consumes: `HarnessConfig` (Task 1), `BuildRunEnvelopeOptions.harness` (Task 2).
- Produces: `builder.withHarness(config: HarnessConfig): this`, and `ReasoningOptions["harness"]?: HarnessConfig`. Task 6 reads `config.reasoningOptions?.harness` for sub-agent inheritance.

**Why it lives on `ReasoningOptions`:** that record already flows builder → `AgentConfig` JSON → `ReactiveAgentsConfig` → the kernel, AND it is already threaded to sub-agents as `parentReasoningOptions` (`sub-agent-executor.ts:140`). Putting the harness there makes serialisation and inheritance fall out of existing machinery instead of adding a parallel path.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/harness-builder.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "./index.js";

describe(".withHarness()", () => {
  it("records the harness config on the built AgentConfig", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ stableToolSurface: true, toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.stableToolSurface).toBe(true);
    expect(cfg.reasoning?.harness?.toolIndex).toBe(true);
  });

  it("merges across calls rather than replacing — later keys win", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ stableToolSurface: true })
      .withHarness({ toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.stableToolSurface).toBe(true);
    expect(cfg.reasoning?.harness?.toolIndex).toBe(true);
  });

  it("round-trips through AgentConfig JSON", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ recencyBudgetChars: 4096 })
      .toConfig();
    const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    expect(json.reasoning?.harness?.recencyBudgetChars).toBe(4096);
  });
});
```

Check the exact accessor `toConfig()` returns before finalising the assertions — mirror whatever `auditRationale` does in the existing builder tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/runtime/src/harness-builder.test.ts`
Expected: FAIL — `withHarness is not a function`.

- [ ] **Step 3: Add the schema**

Create `packages/runtime/src/harness-schema.ts`:

```ts
/**
 * JSON-serialisable mirror of `HarnessConfig` (packages/reasoning). Kept in
 * runtime for the same reason `reasoning-options-schema.ts` is: the Effect
 * Schema row is the AgentConfig persistence contract, and reasoning must not
 * depend on runtime.
 *
 * Every field optional — absent means "do not decide", which is what lets
 * config > env > default hold.
 */
import { Schema } from "effect";

export const HarnessConfigSchema = Schema.Struct({
  lazyDisclosure: Schema.optional(Schema.Boolean),
  toolDiscovery: Schema.optional(Schema.Boolean),
  toolIndex: Schema.optional(Schema.Boolean),
  toolIndexMaxEntries: Schema.optional(Schema.Number),
  verboseRules: Schema.optional(Schema.Boolean),
  stableToolSurface: Schema.optional(Schema.Boolean),
  recencyBudgetChars: Schema.optional(Schema.Number),
  toolResultBudgetChars: Schema.optional(Schema.Number),
  thoughtContinuity: Schema.optional(Schema.Boolean),
  toolObserveSymmetry: Schema.optional(Schema.Boolean),
  auditRationale: Schema.optional(Schema.Boolean),
  treeOfThoughtExploreBudgetMs: Schema.optional(Schema.Number),
  assemblyDebug: Schema.optional(Schema.Boolean),
  promptDumpPathPrefix: Schema.optional(Schema.String),
});
```

In `packages/runtime/src/reasoning-options-schema.ts`, import it and add one field to `ReasoningOptionsJsonSchema`, beside `auditRationale`:

```ts
  /**
   * Harness mechanism switches (W3). Precedence: this config > `RA_*` env var >
   * built-in default. Set via `.withHarness({...})`. Resolved once per run into
   * `RunEnvelope.harness`; `auditRationale` above is the legacy single-field
   * spelling of `harness.auditRationale` and both are honoured.
   */
  harness: Schema.optional(HarnessConfigSchema),
```

- [ ] **Step 4: Add the builder method**

In `packages/runtime/src/builder.ts`, next to `withLeanHarness()` (line 1403):

```ts
    /**
     * Configure harness mechanisms directly — the switches that decide how much
     * the harness spends per model turn and how much it hides from the model.
     *
     * Precedence: this config wins over the matching `RA_*` environment
     * variable, which wins over the built-in default. Calls merge, so
     * `.withHarness({a}).withHarness({b})` keeps both.
     *
     * @example
     * // Keep the tool array byte-stable so the provider's prompt cache survives:
     * .withHarness({ stableToolSurface: true })
     * @example
     * // Small-model profile: show everything, no discovery round trips:
     * .withHarness({ lazyDisclosure: false, toolDiscovery: false, verboseRules: true })
     *
     * @see {@link HarnessProfile} — capability presets (memory/RI/verifier).
     *   `.withHarness()` is the mechanism layer beneath them.
     * @returns `this` for chaining
     */
    withHarness(config: HarnessConfig): this {
        this._harness = { ...this._harness, ...config }
        return this
    }
```

Add the private field beside `_contextProfile` (line 402):

```ts
    private _harness?: HarnessConfig
```

and include it wherever `_contextProfile` is forwarded — notably the sub-agent inheritance snapshot near line 2753 and the `toConfig()` path.

In `packages/runtime/src/builder/to-config.ts`, beside line 137:

```ts
    if (ro?.harness !== undefined) r["harness"] = ro.harness;
```

- [ ] **Step 5: Thread it into the envelope**

In `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts`, at the `buildRunEnvelope(...)` construction (the same place `auditRationale` is passed at line 356), add:

```ts
      harness: config.reasoningOptions?.harness,
```

Do the same at any other `buildRunEnvelope` call site — find them with `grep -rn "buildRunEnvelope(" packages/runtime/src`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/runtime/src/harness-builder.test.ts && bunx turbo run build`
Expected: PASS, build 37/37.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src
git commit -m "feat(runtime): .withHarness() — the public harness control surface"
```

---

### Task 5: Wire `toolDisclosureMode` — kill the dead field

**Files:**
- Modify: `packages/reasoning/src/context/context-profile.ts` (set per-tier defaults; document the derivation)
- Modify: `packages/reasoning/src/harness-config.ts` (add `fromDisclosureMode`)
- Test: `packages/reasoning/src/harness-config.test.ts` (extend)

**Interfaces:**
- Consumes: `HarnessConfig`, `resolveHarnessConfig` (Task 1); `ContextProfile.toolDisclosureMode` (existing declaration at `context-profile.ts:93`).
- Produces: `fromDisclosureMode(mode: "full" | "discover" | "index" | "hybrid"): HarnessConfig`. Nothing later consumes it; this task closes F-4.

**The finding this closes:** `toolDisclosureMode` is declared with 25 lines of JSDoc claiming it "resolves from the per-tier default in `CONTEXT_PROFILES`", no `CONTEXT_PROFILES` entry sets it, and no consumer reads it. It has been a documented lie in the type since it shipped. Task 4 gives it something real to resolve into.

- [ ] **Step 1: Write the failing test**

Append to `packages/reasoning/src/harness-config.test.ts`:

```ts
import { fromDisclosureMode } from "./harness-config.js";

describe("fromDisclosureMode — the profile field becomes real", () => {
  it("full = everything visible, no discovery, no index", () => {
    expect(fromDisclosureMode("full")).toEqual({
      lazyDisclosure: false, toolDiscovery: false, toolIndex: false,
    });
  });

  it("discover = prune plus the discover-tools escape hatch", () => {
    expect(fromDisclosureMode("discover")).toEqual({
      lazyDisclosure: true, toolDiscovery: true, toolIndex: false,
    });
  });

  it("index = prune plus a cheap text index, no discovery round trips", () => {
    expect(fromDisclosureMode("index")).toEqual({
      lazyDisclosure: true, toolDiscovery: false, toolIndex: true,
    });
  });

  it("hybrid = prune with both affordances", () => {
    expect(fromDisclosureMode("hybrid")).toEqual({
      lazyDisclosure: true, toolDiscovery: true, toolIndex: true,
    });
  });

  it("a mode is still overridable field-by-field — explicit beats derived", () => {
    const r = resolveHarnessConfig({ ...fromDisclosureMode("full"), toolIndex: true });
    expect(r.lazyDisclosure).toBe(false);
    expect(r.toolIndex).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/harness-config.test.ts`
Expected: FAIL — `fromDisclosureMode` is not exported.

- [ ] **Step 3: Implement the derivation**

Append to `packages/reasoning/src/harness-config.ts`:

```ts
/** The four disclosure postures a `ContextProfile` can name. */
export type ToolDisclosureMode = "full" | "discover" | "index" | "hybrid";

/**
 * Expand a profile's `toolDisclosureMode` into the three mechanism switches it
 * actually means. This is what makes `ContextProfile.toolDisclosureMode` a real
 * field rather than a declared-and-unread one (spec finding F-4).
 *
 * The result is a plain `HarnessConfig`, so a caller can spread it and then
 * override any single field — the mode is a shorthand, never a lock.
 */
export function fromDisclosureMode(mode: ToolDisclosureMode): HarnessConfig {
  switch (mode) {
    case "full":
      return { lazyDisclosure: false, toolDiscovery: false, toolIndex: false };
    case "discover":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: false };
    case "index":
      return { lazyDisclosure: true, toolDiscovery: false, toolIndex: true };
    case "hybrid":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: true };
  }
}
```

- [ ] **Step 4: Set the per-tier defaults the JSDoc already promises**

In `packages/reasoning/src/context/context-profile.ts`, add `toolDisclosureMode` to each `CONTEXT_PROFILES` entry, and replace the stale sentence in the field's JSDoc:

```ts
  // local (small models — a large tool array is itself the failure mode):
  toolDisclosureMode: "index",
  // mid:
  toolDisclosureMode: "hybrid",
  // large:
  toolDisclosureMode: "discover",
  // frontier (biggest context, cheapest attention — pruning buys least here):
  toolDisclosureMode: "discover",
```

**Ruling to record in the commit body:** these four tier defaults are *declarations of intent, not measured verdicts*. Set them, then hand them to `ablation-warden` per §2 as amended. Do not claim lift for them in any doc until that measurement exists. If the warden's verdict contradicts a default, the default changes — that is the point of writing them down where a gate can see them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/reasoning/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/harness-config.ts packages/reasoning/src/harness-config.test.ts packages/reasoning/src/context/context-profile.ts
git commit -m "feat(reasoning): wire toolDisclosureMode to real mechanism switches (F-4)"
```

---

### Task 6: Sub-agent inheritance and the red-on-cut gate

**Files:**
- Modify: `packages/runtime/src/builder/build-effect/sub-agent-executor.ts` (add `parentHarness`)
- Modify: `scripts/check-cross-cutting.sh` (add `harness` to check 5's field list; add check 11)
- Create: `scripts/check-harness-config.sh`
- Test: `packages/runtime/src/sub-agent-harness-inheritance.test.ts` (create)

**Interfaces:**
- Consumes: `HarnessConfig` (Task 1), `.withHarness()` (Task 4).
- Produces: `SubAgentExecutorDeps.parentHarness?: HarnessConfig`. Terminal task — nothing consumes this.

**Why this task is not optional:** check 5/10 of `check-cross-cutting.sh` exists because a run-wide policy field that is not threaded to `sub-agent-executor.ts` "silently drops on every sub-agent". Harness config is now exactly such a field. Adding the surface without adding it to that gate ships the next instance of the defect the gate was built for.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/sub-agent-harness-inheritance.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// A structural test, matching how check 5/10 reasons: the field must be
// DECLARED on the deps record and READ when the child config is built.
// A behavioural end-to-end sub-agent run needs a live model; this pins the
// wiring that the gate protects.
describe("sub-agents inherit the parent's harness config", () => {
  const src = readFileSync(
    "packages/runtime/src/builder/build-effect/sub-agent-executor.ts",
    "utf8",
  );

  it("declares parentHarness on the deps record", () => {
    expect(src).toContain("parentHarness");
  });

  it("forwards it into the child's reasoning options", () => {
    expect(src).toMatch(/harness:\s*deps\.parentHarness/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/runtime/src/sub-agent-harness-inheritance.test.ts`
Expected: FAIL — both assertions.

- [ ] **Step 3: Thread the field**

In `packages/runtime/src/builder/build-effect/sub-agent-executor.ts`, beside `parentContextProfile` (line 148):

```ts
  /**
   * Parent's harness mechanism config. A sub-agent that does not inherit this
   * silently runs a DIFFERENT harness than its parent — which is the whole
   * defect class check 5/10 exists to catch.
   */
  readonly parentHarness?: HarnessConfig;
```

and where the child's reasoning options are assembled, add `harness: deps.parentHarness`. In `packages/runtime/src/builder.ts` (~line 2561, where `parentContextProfile` is captured), pass `parentHarness: self._harness`.

- [ ] **Step 4: Add the gate**

Create `scripts/check-harness-config.sh`:

```bash
#!/usr/bin/env bash
# Harness mechanism switches must be read from the CARRIED, resolved config —
# never by calling an env resolver at a call site.
#
# Task 3 (W3, 2026-08-27) migrated 19 call sites off zero-argument resolvers so
# that two agents in one process can hold different harness configs and a
# sub-agent can inherit its parent's. A single re-added direct call silently
# restores the process-global read for that mechanism, and nothing else in the
# suite would notice: the value is usually correct, because usually there is
# only one agent in the process.
#
# harness-config.ts is the ONE legal caller — it is the env layer's consumer.
set -euo pipefail
cd "$(dirname "$0")/.."

RESOLVERS='lazyDisclosureEnabled|toolDiscoveryEnabled|toolIndexEnabled|toolIndexMaxEntriesFlag|verboseRulesEnabled|stableToolSurfaceEnabled|recencyBudgetCharsOverride|toolResultBudgetCharsOverride|thoughtContinuityEnabled|toolObserveSymmetryEnabled|rationaleAuditEnabled|treeOfThoughtExploreBudgetMs|assemblyDebugEnabled|promptDumpPathPrefix'

STRAYS=$(grep -rnE "\b($RESOLVERS)\(" packages --include=*.ts \
  | grep -v '/dist/' \
  | grep -v '\.test\.' \
  | grep -v '/benchmarks/' \
  | grep -v 'reasoning/src/harness-flags\.ts' \
  | grep -v 'reasoning/src/harness-config\.ts' \
  || true)

if [ -n "$STRAYS" ]; then
  echo "FAIL: a harness env resolver is called outside harness-config.ts:"
  echo "$STRAYS"
  echo ""
  echo "Read the mechanism off the carried ResolvedHarness instead"
  echo "(input.harness / inputs.harness / c.harness). Calling the resolver here"
  echo "restores the process-global read that .withHarness() exists to remove."
  exit 1
fi
echo "OK: every harness mechanism resolves through the carried config."
```

`chmod +x scripts/check-harness-config.sh`.

In `scripts/check-cross-cutting.sh`, add `harness` to check 5's `parent_field` list, and append check 11 in the shape of checks 9 and 10 (mktemp, delegate, FAIL/OK line). Renumber the existing "(N/10)" labels to "(N/11)".

- [ ] **Step 5: Prove the gate is red-on-cut**

This is the step that makes the gate worth having. Temporarily re-introduce a direct call — in `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts`, change the stable-surface condition back to `if (stableToolSurfaceEnabled()) {`. Run `./scripts/check-harness-config.sh` and confirm it FAILS naming that file and line. Then `git checkout -- packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts` and confirm it passes again. A gate that has never been observed failing is not known to work.

- [ ] **Step 6: Run everything**

Run: `bunx turbo run build && bun test --timeout 60000 && ./scripts/check-cross-cutting.sh`
Expected: build 37/37; suite 0 failures; all 11 checks OK.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src scripts/
git commit -m "feat(runtime): sub-agents inherit the parent harness config, gated red-on-cut"
```

---

### Task 7: Documentation — make it discoverable

**Files:**
- Modify: `.env.example`
- Create: `apps/docs/src/content/docs/features/harness-control.md`
- Modify: `README.md` (one line in the API overview)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above. Produces: nothing consumed by code.

**The finding this closes:** a `grep` for `RA_STABLE_TOOL_SURFACE`, `RA_LAZY_TOOLS`, and `RA_TOOL_INDEX` across `apps/docs/src`, `README.md`, and `.env.example` returned **zero hits** on 2026-08-27. The framework's most differentiating controls were undocumented.

- [ ] **Step 1: Document every variable in `.env.example`**

Append a section listing all 14 `RA_*` mechanism variables, each with one line saying what it does, its default, and the `.withHarness()` field that supersedes it. Lead the section with:

```
# ─── Harness mechanisms ───
# Prefer `.withHarness({...})` in code — it is typed, per-agent, and inherited by
# sub-agents. These variables are the FALLBACK layer: they apply only where the
# config does not decide, and they are process-global.
```

- [ ] **Step 2: Write the feature page**

Create `apps/docs/src/content/docs/features/harness-control.md` following the frontmatter and structure of a neighbouring page in that directory. It must cover: the three-layer precedence; a table of all 14 fields with defaults; the four `toolDisclosureMode` postures and when to pick each; a small-model worked example; and an explicit statement that the per-tier disclosure defaults are declarations of intent pending `ablation-warden` measurement — do not claim measured lift.

- [ ] **Step 3: Add the CHANGELOG entry**

Under the unreleased heading, in the existing style:

```markdown
### Added
- `.withHarness({...})` — typed, per-agent configuration for all 14 harness
  mechanisms (tool disclosure, discovery, tool index, verbose rules, stable tool
  surface, context budgets, thought continuity, observe symmetry, rationale
  audit, ToT explore budget). Precedence: config > `RA_*` env var > default.
  Inherited by sub-agents. Previously these were reachable only through
  process-global environment variables, so two agents in one process could not
  differ and no sub-agent inherited anything.
- `ContextProfile.toolDisclosureMode` is now read (`"full" | "discover" |
  "index" | "hybrid"`), with per-tier defaults. It was declared and unconsumed.
```

- [ ] **Step 4: Verify the docs build**

Run: `bunx turbo run build`
Expected: 37/37 successful.

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/docs README.md CHANGELOG.md
git commit -m "docs: document the harness control surface and its precedence"
```

---

## Post-plan: what this does NOT do

- **No default changes.** Every default resolves to today's value. The four
  `toolDisclosureMode` tier defaults are the only new declarations, and they are
  explicitly unmeasured pending `ablation-warden` (Task 5 Step 4's ruling).
- **`overhaulEnabled()` stays env-only.** Its single call site is
  `runtime/src/builder/build-effect/runtime-construction.ts` — a build-time
  construction switch, not a per-run mechanism. It is out of `HarnessConfig` by
  design; note it in `.env.example` as deployment config.
- **`packages/tools/src/flags.ts` and `packages/a2a/src/flags.ts` are untouched.**
  They are separate resolvers in packages that cannot import `harness-flags.ts`
  without a cycle, and they gate deployment/sandbox concerns rather than harness
  mechanisms. A follow-up may give them the same treatment; this plan does not.
- **No new north-star document.** This implements W3 of the 2026-08-24
  amendment.
