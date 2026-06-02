# Canonical-Collapse Branch Landing — Sprint 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `overhaul/agentic-core-2026-05-31` into `main` clean — flags removed, legacy maze deleted, three foundation contracts (TaskContract, DeliverableProvenance, Capability) typed-and-pinned — so the next sprints have a maze-free base.

**Architecture:** Two stages. Stage A is **structural cleanup** under the proof-gate harness — flip canonical to default (no flags), delete legacy `curate()`, delete dead capability entry points. Stage B is **foundation contracts** — three new types in `packages/core/src/contracts/` that the rest of Sprints 2-4 build on. Each task is bench-validated cross-arm cross-tier; nothing ships if equal-or-better invariant regresses.

**Tech Stack:** TypeScript 6.0.3, Effect-TS, Bun 1.3.10, qwen3.5 + claude-haiku + claude-sonnet bench tiers.

**Companion specs:**
- [[2026-06-02-canonical-contracts-and-invariants]] — the typed contract layer (target)
- [[2026-05-31-canonical-harness-core]] — the mechanism shape (current)
- [[2026-05-31-canonical-context-assembly]] — the data-flow shape (shipped)
- `05-DESIGN-NORTH-STAR.md §6.5` — where this sprint lives in the master plan

**Hard invariants (cannot be violated by any task):**
1. **Equal-or-better cross-tier** — every refactor proven, not assumed: faithfulness ≥, pass^k ≥, dishonest-success ≤, deliverable ≥, AND tokens ≤ (or +3pp lift buys ≤15% overhead).
2. **No deletion without aggregate live win** — strangler-fig per canonical-harness-core P1.
3. **No flags reintroduced** — once canonical is default, the legacy path is GONE, not gated.
4. **Tests stay green at every commit** — never land a red commit.

---

## Stage A — Structural Cleanup (the maze deletion)

### Task A1: Snapshot the current cross-tier baseline

**Files:**
- Read: `packages/benchmarks/src/sessions/context-stress.ts`
- Read: `wiki/Research/Harness-Reports/` (last week of cross-arm receipts)

- [ ] **A1.1: Capture pre-deletion baseline (qwen3.5 local + claude-haiku mid + claude-sonnet frontier).**

Run: `cd packages/benchmarks && bun run src/run.ts --session context-stress --runs 3 --output /tmp/sprint1-baseline/local.json --provider ollama --model qwen3.5:latest --verbose`

Then for mid + frontier (one at a time so traces stay isolated):
```bash
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY bun run src/run.ts --session context-stress --runs 3 --output /tmp/sprint1-baseline/mid.json --provider anthropic --model claude-haiku-4-5 --verbose
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY bun run src/run.ts --session context-stress --runs 3 --output /tmp/sprint1-baseline/frontier.json --provider anthropic --model claude-sonnet-4-6 --verbose
```

Expected: 3 JSON outputs in `/tmp/sprint1-baseline/`. Both arms (`ra-full` and `ra-full-assembly-off`) measured. This is the reference for every subsequent ablation.

- [ ] **A1.2: Archive the baseline to wiki.**

```bash
mkdir -p wiki/Research/Harness-Reports/sprint1-canonical-collapse/
cp /tmp/sprint1-baseline/*.json wiki/Research/Harness-Reports/sprint1-canonical-collapse/
```

Write `wiki/Research/Harness-Reports/sprint1-canonical-collapse/baseline-2026-06-02.md` summarizing: per-tier mean accuracy / reliability / tokens for each arm; the specific cells that succeed vs fail.

- [ ] **A1.3: Commit the baseline artifact.**

```bash
git add wiki/Research/Harness-Reports/sprint1-canonical-collapse/
git commit -m "evidence(sprint1): pre-deletion cross-tier baseline (qwen3.5 + haiku + sonnet)"
```

---

### Task A2: Delete `RA_ASSEMBLY` flag — canonical is the only path

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts` (the `if (assemblyEnabled()) { ... } else { defaultContextCurator.curate(...) }` branch at ~347-366)
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts` (delete `assemblyEnabled` export at ~548-550)
- Modify: `packages/benchmarks/src/session.ts` (delete `ra-full-assembly-off` variant from `ABLATION_VARIANTS`)
- Modify: `packages/benchmarks/tests/benchmark-v2.test.ts` (cardinality pins from 11→10, internal 6→5)
- Modify: `packages/benchmarks/src/sessions/context-stress.ts` (drop the assembly-off arm; session becomes single-arm pin)
- Delete: any test files specifically for the assembly-off arm path

- [ ] **A2.1: Write a failing test pinning canonical-only.**

```ts
// packages/reasoning/tests/strategies/kernel/no-legacy-curate-path.test.ts
import { describe, it, expect } from "bun:test";
import { think } from "../../../src/kernel/capabilities/reason/think.js";

describe("canonical-only assembly (no RA_ASSEMBLY flag)", () => {
  it("does not reference assemblyEnabled or RA_ASSEMBLY", async () => {
    const src = await Bun.file(`${import.meta.dir}/../../../src/kernel/capabilities/reason/think.ts`).text();
    expect(src).not.toContain("assemblyEnabled");
    expect(src).not.toContain("RA_ASSEMBLY");
  });
  it("does not import defaultContextCurator", async () => {
    const src = await Bun.file(`${import.meta.dir}/../../../src/kernel/capabilities/reason/think.ts`).text();
    expect(src).not.toContain("defaultContextCurator");
  });
});
```

Run: `bun test tests/strategies/kernel/no-legacy-curate-path.test.ts`
Expected: FAIL (file still imports / branches on RA_ASSEMBLY).

- [ ] **A2.2: Delete the else-branch + the flag check.**

In `think.ts` around line 344-367, replace:
```ts
if (assemblyEnabled()) {
  const { request, trace } = project(...);
  systemPromptText = request.systemPrompt;
  conversationMessages = toLLMMessages(request.messages);
  compressionApplied = undefined;
  if (process.env.RA_ASSEMBLY_DEBUG === "1") console.error(...);
} else {
  ({ systemPrompt: systemPromptText, messages: conversationMessages, compressionApplied } = defaultContextCurator.curate(...));
}
```
with:
```ts
const { request, trace } = project(
  fromKernelState(state, profile, { system: effectiveSystemPrompt ?? "" }, { schemas: promptSchemas }, input.task),
);
systemPromptText = request.systemPrompt;
conversationMessages = toLLMMessages(request.messages);
compressionApplied = undefined;
if (process.env.RA_ASSEMBLY_DEBUG === "1") {
  console.error(`[RA_ASSEMBLY_TRACE] ${JSON.stringify({ taskId: state.taskId, iteration: state.iteration, capability: trace.capability, stages: trace.stages, messages: trace.messages, tools: trace.tools })}`);
}
```

Delete `assemblyEnabled` export from `think-guards.ts`.

- [ ] **A2.3: Drop the `ra-full-assembly-off` variant.**

In `packages/benchmarks/src/session.ts`, delete the entry:
```ts
{
  type: "internal", id: "ra-full-assembly-off", label: "RA Full (legacy curate, RA_ASSEMBLY=0)",
  config: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true, env: { RA_ASSEMBLY: "0" } },
},
```

In `packages/benchmarks/src/sessions/context-stress.ts`, change `harnessVariants` from `[getVariant("ra-full"), getVariant("ra-full-assembly-off")]` to `[getVariant("ra-full")]`. Update doc comment.

- [ ] **A2.4: Fix cardinality pins.**

`packages/benchmarks/tests/benchmark-v2.test.ts` lines 119, 127, 350, 359, 396: revert `toHaveLength(11)` → `toHaveLength(10)`; internal `(6)` → `(5)`. Update inline comments mentioning the removed variant.

- [ ] **A2.5: Run + fix cascading failures.**

```bash
bun test 2>&1 | tail -10
```

Fix any test that referenced `assemblyEnabled` / `RA_ASSEMBLY` / `ra-full-assembly-off`. Expected pass count after fixes: ≥ 1614 (was 1614 at HEAD).

- [ ] **A2.6: Commit.**

```bash
git add -p packages/reasoning packages/benchmarks
git commit -m "$(cat <<'EOF'
refactor(canonical): delete RA_ASSEMBLY flag — project() is the only assembler

Removes the assemblyEnabled gate at think.ts:347 and the legacy
defaultContextCurator.curate() else-branch (1 caller). Canonical
project() is now the sole assembler — invariant I2 from the
canonical-contracts spec.

Bench session drops the ra-full-assembly-off variant since the legacy
path no longer exists. Cardinality pins in benchmark-v2.test.ts adjust
11→10 / 6→5.

Pre-deletion baseline archived in wiki/Research/Harness-Reports/sprint1-
canonical-collapse/. Post-deletion bench: project arm matches the
ra-full numbers from baseline; no equal-or-better regression.
EOF
)"
```

- [ ] **A2.7: Validate equal-or-better invariant.**

Re-run the cross-tier bench (same command as A1.1). Compare to baseline. If any tier shows ANY axis regression (accuracy, reliability, tokens, dishonest-success-rate), **STOP and bisect**. Otherwise: archive new receipt.

---

### Task A3: Delete legacy `defaultContextCurator` + `curate()` module

**Files:**
- Delete: `packages/reasoning/src/context/context-curator.ts`
- Delete: any test specific to `context-curator.ts`
- Modify: every importer of `defaultContextCurator` / `ContextCurator` (grep first to count)

- [ ] **A3.1: Map the dependency surface.**

```bash
rtk grep -rn "defaultContextCurator\|context-curator\|ContextCurator" packages/ apps/ --include="*.ts" 2>&1 | grep -v dist | grep -v "test" | head -30
```

Expect: ~13 src files, ~9 tests (per canonical-collapse §2 deferred items). Document each importer.

- [ ] **A3.2: Migrate each importer.**

Per importer, choose one:
- **If the importer only uses `curate()` for its messages output**: replace with `project()` call via `fromKernelState` helper (already exists).
- **If the importer uses `ContextCurator` type as a config shape**: delete that field; project() is configuration-free.
- **If the importer is dead** (zero downstream callers): delete it.

Commit each importer migration separately so bisection is cheap if anything regresses.

- [ ] **A3.3: Delete `context-curator.ts` + its tests.**

```bash
rm packages/reasoning/src/context/context-curator.ts
rm packages/reasoning/tests/context/context-curator*.test.ts
# Plus any test in tests/context/ that specifically exercises the legacy path
```

- [ ] **A3.4: Run full suite + cross-tier bench.**

```bash
bun test 2>&1 | tail -5
# Then bench:
cd packages/benchmarks && bun run src/run.ts --session context-stress --runs 3 --output /tmp/sprint1-postdelete/local.json --provider ollama --model qwen3.5:latest --verbose
```

Expected: 1614+ tests pass; bench equal-or-better vs baseline.

- [ ] **A3.5: Commit.**

```bash
git commit -m "refactor(canonical): delete defaultContextCurator + curate() — project() is sole assembler

13 src importers migrated to project()/fromKernelState (each as own commit
for bisectability), 9 tests deleted/migrated, context-curator.ts removed.

Aggregate live win: cross-tier bench equal-or-better vs baseline
(local + mid + frontier receipts in wiki/Research/Harness-Reports/sprint1-).

Closes canonical-collapse §2 deferred deletion item.
"
```

---

### Task A4: Delete `RA_OVERHAUL` flag (if present) + `RA_POST_CONDITIONS` make unconditional

**Files:**
- Grep for `RA_OVERHAUL` and `RA_POST_CONDITIONS` usage
- Each callsite either deletes the flag-gate (make canonical default) or removes the legacy branch

- [ ] **A4.1: Map RA_OVERHAUL surface.**

```bash
rtk grep -rn "RA_OVERHAUL" packages/ --include="*.ts" | grep -v dist | head -20
```

For each call site:
- If gating canonical path → remove the gate (canonical is always on)
- If gating legacy path → delete the legacy branch

- [ ] **A4.2: Map RA_POST_CONDITIONS surface.**

```bash
rtk grep -rn "RA_POST_CONDITIONS" packages/ --include="*.ts" | grep -v dist | head -20
```

Per canonical-collapse §2 deferred: make post-conditions unconditional in reflexion + arbitrator. Delete the opt-out branches.

- [ ] **A4.3: Test + bench.**

`bun test` and cross-tier bench. Equal-or-better gate.

- [ ] **A4.4: Commit.**

```bash
git commit -m "refactor(canonical): RA_OVERHAUL + RA_POST_CONDITIONS flags removed; canonical is default

Post-condition state-grounded verification is now unconditional per
the canonical-harness-core verification mandate. RA_OVERHAUL gating
scaffolding deleted — canonical kernel is the only path.

Surviving knobs (intentional):
- RA_ASSEMBLY_DEBUG=1     — trace dump (developer ergonomic)
- RA_RECENCY_BUDGET_CHARS — recency-window override (ablation)
- RA_TOOL_RESULT_BUDGET_CHARS — per-result preserve override (ablation)
- RA_RECALL_GATE          — overflow recall gate (default-on opt-out)
- RA_LAZY_TOOLS           — lazy disclosure (Sprint 4 will revisit per §6.5)
"
```

---

## Stage B — Foundation Contracts

### Task B1: `TaskContract` type

**Files:**
- Create: `packages/core/src/contracts/task-contract.ts`
- Create: `packages/core/tests/contracts/task-contract.test.ts`
- Modify: `packages/benchmarks/src/types.ts` (BenchmarkTask extends/aligns with TaskContract)
- Modify: `packages/benchmarks/src/tasks/context-stress.ts` (declare `tools: ["file-read"]` explicitly)
- Modify: `packages/benchmarks/src/runner.ts` (use TaskContract.tools to drive `.withTools({builtins: [...]})`)

- [ ] **B1.1: Write failing test for TaskContract shape.**

```ts
// packages/core/tests/contracts/task-contract.test.ts
import { describe, it, expect } from "bun:test";
import type { TaskContract, ToolRequirement } from "../../src/contracts/task-contract.js";

describe("TaskContract", () => {
  it("compiles a contract with required tools", () => {
    const c: TaskContract = {
      prompt: "read report.md",
      tools: [{ kind: "required", name: "file-read" }],
      success: { type: "regex", pattern: "## Summary" },
    };
    expect(c.tools[0].name).toBe("file-read");
  });
  it("enforces ToolRequirement discriminated union", () => {
    const req: ToolRequirement = { kind: "required", name: "file-read" };
    const avail: ToolRequirement = { kind: "available", name: "find" };
    const forb: ToolRequirement = { kind: "forbidden", name: "shell-execute" };
    expect([req.kind, avail.kind, forb.kind]).toEqual(["required", "available", "forbidden"]);
  });
});
```

- [ ] **B1.2: Create the type.**

```ts
// packages/core/src/contracts/task-contract.ts
export type ToolRequirement =
  | { readonly kind: "required";  readonly name: string }
  | { readonly kind: "available"; readonly name: string }
  | { readonly kind: "forbidden"; readonly name: string };

export interface FixtureContract {
  readonly path: string;
  readonly content: string;
  readonly readableVia?: readonly string[];
}

export interface ModelFloor {
  readonly window?: number;
  readonly thinking?: boolean;
  readonly nativeFC?: boolean;
}

export type SuccessCriterion =
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "llm-judge"; readonly rubric: string; readonly passThreshold?: number }
  | { readonly type: "predicate"; readonly fn: (output: string) => boolean };

export interface TaskContract {
  readonly prompt: string;
  readonly tools: readonly ToolRequirement[];
  readonly fixtures?: readonly FixtureContract[];
  readonly modelFloor?: ModelFloor;
  readonly success: SuccessCriterion;
  readonly outputShape?: {
    readonly format?: "prose" | "json" | "markdown";
    readonly mustInclude?: readonly string[];
  };
}
```

Run: `bun test packages/core/tests/contracts/task-contract.test.ts`. Expected: pass.

- [ ] **B1.3: Bench tasks declare `tools` explicitly.**

In `packages/benchmarks/src/tasks/context-stress.ts`, add `tools: [{ kind: "required", name: "file-read" }]` to each fixture-bearing task. Update `BenchmarkTask` type in `packages/benchmarks/src/types.ts` to include optional `tools: readonly ToolRequirement[]` field (importing from `@reactive-agents/core`).

- [ ] **B1.4: Runner derives `.withTools({builtins: [...]})` from `task.tools`.**

In `packages/benchmarks/src/runner.ts:590-604`, replace the fixtures-only heuristic with contract-driven logic:
```ts
if (config.tools) {
  // Derive required builtins from TaskContract.tools (preferred) or fall back
  // to fixtures heuristic for tasks not yet migrated to the contract.
  const declaredTools = task.tools?.filter((t) => t.kind === "required" || t.kind === "available").map((t) => t.name) ?? [];
  const fixtureTools = task.fixtures?.length ? ["file-read", "file-write"] : [];
  const builtins = [...new Set([...declaredTools, ...fixtureTools])];
  if (builtins.length > 0) {
    builder.withTools({ builtins });
  } else {
    builder.withTools();
  }
}
```

- [ ] **B1.5: Test + bench.**

`bun test packages/benchmarks` then full cross-tier bench. Equal-or-better gate.

- [ ] **B1.6: Commit.**

```bash
git commit -m "feat(contracts): TaskContract type + bench-task migration

New typed contract in packages/core/src/contracts/task-contract.ts —
TaskContract.tools as ToolRequirement[] (required | available | forbidden)
replaces the boolean requiresTools field for unambiguous tool exposure.

Bench cs-overflow-* + cs-recall-temptation tasks migrate to declare
tools: [{kind:'required', name:'file-read'}] explicitly. Runner drives
.withTools({builtins:[...]}) from the declared contract, with the
fixtures fallback retained for un-migrated tasks.

First step of Sprint 1 contracts per §6.5 of DESIGN-NORTH-STAR.
"
```

---

### Task B2: `DeliverableProvenance` typed channel

**Files:**
- Create: `packages/core/src/contracts/deliverable.ts`
- Create: `packages/core/tests/contracts/deliverable.test.ts`
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (private setter for `state.output`)
- Modify: every termination/output-assembly path that mutates `state.output`

- [ ] **B2.1: Map current `state.output` writers.**

```bash
rtk grep -rn "state.output\s*=\|output:\s*[^,}]" packages/reasoning/src/kernel/ --include="*.ts" | grep -v dist | grep -v test
```

Expect ~10-15 call sites across runner.ts, terminate.ts, strategy adapters.

- [ ] **B2.2: Write failing test pinning the channel.**

```ts
// packages/core/tests/contracts/deliverable.test.ts
import { describe, it, expect } from "bun:test";
import type { Deliverable, ValidatedObservation } from "../../src/contracts/deliverable.js";

describe("Deliverable provenance", () => {
  it("model_synthesis carries the thought", () => {
    const d: Deliverable = {
      source: "model_synthesis",
      thought: { type: "thought", content: "the answer is X", iteration: 5 } as any,
      chars: 18,
    };
    expect(d.source).toBe("model_synthesis");
  });
  it("ValidatedObservation requires success:true invariant", () => {
    const obs: ValidatedObservation = {
      _validated: "tool-success",
      toolName: "file-read",
      callId: "c1",
      content: "report content",
      invariant: { success: true, toolInState: true },
    };
    expect(obs._validated).toBe("tool-success");
  });
});
```

- [ ] **B2.3: Create the type + the channel function.**

```ts
// packages/core/src/contracts/deliverable.ts
export interface ValidatedObservation {
  readonly _validated: "tool-success";
  readonly toolName: string;
  readonly callId: string;
  readonly content: string;
  readonly invariant: { readonly success: true; readonly toolInState: true };
}

export type Deliverable =
  | { readonly source: "model_synthesis"; readonly thought: ThoughtStep; readonly chars: number }
  | { readonly source: "tool_artifact"; readonly observation: ValidatedObservation }
  | { readonly source: "harness_synthesis"; readonly assembled: readonly ValidatedObservation[]; readonly synthesisCall: LLMRoundTripRef }
  | { readonly source: "sentinel"; readonly reason: "no_substantive_output" | "max_iterations_no_artifacts" };

// Imports must come from kernel-state; this file declares the shape only.
export interface ThoughtStep { readonly type: "thought"; readonly content: string; readonly iteration: number }
export interface LLMRoundTripRef { readonly callId: string }
```

- [ ] **B2.4: Add `commitDeliverable()` to kernel-state.**

```ts
// packages/reasoning/src/kernel/state/kernel-state.ts
import type { Deliverable } from "@reactive-agents/core/contracts/deliverable";

export function commitDeliverable(state: KernelState, d: Deliverable): KernelState {
  // The sole writer of state.output for terminal commitments.
  const content = deliverableToContent(d);
  return transitionState(state, {
    output: content,
    meta: { ...state.meta, deliverableSource: d.source },
  });
}

function deliverableToContent(d: Deliverable): string {
  switch (d.source) {
    case "model_synthesis":      return d.thought.content;
    case "tool_artifact":        return d.observation.content;
    case "harness_synthesis":    return d.assembled.map((o) => o.content).join("\n\n");
    case "sentinel":             return "Task complete.";
  }
}
```

- [ ] **B2.5: Migrate writers (one at a time, separate commits).**

For each `state.output = ...` call site:
1. Construct a `Deliverable` value matching the case
2. Call `commitDeliverable(state, deliverable)` instead
3. Run tests; commit
4. Cross-tier bench at the END of all migrations (not after each, too expensive)

Order: terminate.ts → runner.ts → output-synthesis.ts → strategy adapters.

- [ ] **B2.6: Make `state.output` setter private (lint rule).**

Add a unit test that scans the codebase and fails if any file outside `kernel-state.ts` directly assigns `state.output = ...` or returns an object with a literal `output: <string>` field.

- [ ] **B2.7: Final test + cross-tier bench.**

Equal-or-better gate (no behavior change expected; this is a type-level migration). Commit.

```bash
git commit -m "feat(contracts): DeliverableProvenance — typed channel into state.output

State.output now sets only via commitDeliverable(state, Deliverable).
Deliverable is a discriminated union over (model_synthesis | tool_artifact
| harness_synthesis | sentinel). ValidatedObservation carries an invariant
shape that dispatch-rejection observations cannot be widened to — the
2026-06-02 deliverable-leak class is now constructively impossible.

Migrates 13 termination/output-assembly call sites to the single channel.
Lint test pins zero direct state.output mutations outside kernel-state.ts.

Closes invariant I3 from canonical-contracts spec.
"
```

---

### Task B3: `Capability` consolidation (single resolver, source-tagged)

**Files:**
- Create: `packages/core/src/capability/resolver.ts` (the single source)
- Create: `packages/core/src/capability/static-table.ts` (merged tier + model table)
- Create: `packages/core/tests/capability/resolver.test.ts`
- Modify (re-export shim): `packages/reasoning/src/assembly/capability.ts`
- Modify (re-export shim): `packages/llm-provider/src/capability-resolver.ts`
- Modify (re-export shim): `packages/reasoning/src/context/profile-resolver.ts`
- Modify: every consumer that constructs a capability shape directly

- [ ] **B3.1: Merge the two static tables.**

`STATIC_CAPABILITIES` (llm-provider) + `CONTEXT_PROFILES` (reasoning) merge into one table at `packages/core/src/capability/static-table.ts` keyed by `provider/model`. Each entry carries: window, recommendedNumCtx, tier, dialect, supports flags, **AND** toolResultPreserveBudget per tier-aware semantics.

- [ ] **B3.2: Write the single resolver.**

```ts
// packages/core/src/capability/resolver.ts
import { STATIC_CAPABILITIES, FALLBACK_CAPABILITY } from "./static-table.js";
import type { Capability, CapabilitySource } from "../contracts/capability.js";

export interface CapabilityResolveOptions {
  readonly cache?: CapabilityCache;
  readonly probe?: CapabilityProbe;
  readonly onFallback?: (provider: string, model: string) => void;
}

export function resolveCapability(provider: string, model: string, opts: CapabilityResolveOptions = {}): Capability {
  // Tier 1: cache (probed previously)
  const cached = opts.cache?.get(provider, model);
  if (cached) return { ...cached, source: "cache" };
  // Tier 2: probe (live)
  // (Wired in Sprint 3; for now skip-if-unavailable)
  // Tier 3: static table
  const key = `${provider}/${model}`;
  const staticEntry = STATIC_CAPABILITIES[key];
  if (staticEntry) return { ...staticEntry, source: "static-table" };
  // Tier 4: fallback (LOUDLY)
  opts.onFallback?.(provider, model);
  return { ...FALLBACK_CAPABILITY, provider, model, source: "fallback" };
}
```

- [ ] **B3.3: Add the source field to `Capability` type.**

```ts
// packages/core/src/contracts/capability.ts
export type CapabilitySource = "probe" | "cache" | "static-table" | "fallback";
export interface Capability {
  readonly provider: string;
  readonly model: string;
  readonly effectiveWindowChars: number; // ~65% of claimed per Chroma Context Rot
  readonly recommendedNumCtx: number;
  readonly tier: "local" | "mid" | "large" | "frontier";
  readonly dialect: "native-fc" | "text-parse" | "none";
  readonly toolResultPreserveBudget: number;
  readonly supports: {
    readonly thinking: boolean;
    readonly streamingToolCalls: boolean;
    readonly promptCaching: boolean;
    readonly vision: boolean;
  };
  readonly source: CapabilitySource;
}
```

- [ ] **B3.4: Re-export shims for the old entry points.**

`packages/reasoning/src/assembly/capability.ts`, `packages/llm-provider/src/capability-resolver.ts`, `packages/reasoning/src/context/profile-resolver.ts` become thin re-exports that delegate to `@reactive-agents/core/capability/resolver`. Their tests stay green by wrapping the new contract shape into the old shape where call sites still expect it.

- [ ] **B3.5: Pin tests on the merged behavior.**

```ts
// packages/core/tests/capability/resolver.test.ts
describe("CapabilityResolver", () => {
  it("returns static-table for qwen3.5:latest with window 32768", () => {
    const cap = resolveCapability("ollama", "qwen3.5:latest");
    expect(cap.source).toBe("static-table");
    expect(cap.recommendedNumCtx).toBe(32768);
  });
  it("returns fallback for unknown model with source=fallback", () => {
    const cap = resolveCapability("ollama", "unknown-model-xyz");
    expect(cap.source).toBe("fallback");
    expect(cap.recommendedNumCtx).toBe(2048);
  });
  it("onFallback fires when fallback path taken", () => {
    let warned = "";
    resolveCapability("ollama", "another-unknown", { onFallback: (p, m) => { warned = `${p}/${m}`; } });
    expect(warned).toBe("ollama/another-unknown");
  });
});
```

- [ ] **B3.6: Final bench cross-tier.**

Equal-or-better gate. Commit.

```bash
git commit -m "feat(contracts): single source-tagged Capability resolver

Six entry points (CONTEXT_PROFILES, STATIC_CAPABILITIES, 3 resolveCapability
functions, applyCapabilityMaxTokens) consolidate into one resolver at
@reactive-agents/core/capability/resolver. Old entry points become thin
re-exports.

Capability.source = 'probe' | 'cache' | 'static-table' | 'fallback' makes
the silent-fallback class loud. Tests pin qwen3.5:latest resolution +
fallback warning behavior.

Closes invariant I4 from canonical-contracts spec.
"
```

---

## Final landing

### Task F1: Sprint 1 exit gate
- [ ] **F1.1: Full test suite green** — `bun test` workspace-wide.
- [ ] **F1.2: Cross-tier bench equal-or-better** vs Stage-A baseline on all tiers (local + mid + frontier).
- [ ] **F1.3: Zero `RA_ASSEMBLY` / `RA_OVERHAUL` / `RA_POST_CONDITIONS` references** in `packages/` (grep verifies).
- [ ] **F1.4: Zero imports of `defaultContextCurator`** anywhere.
- [ ] **F1.5: Zero direct `state.output =` mutations outside kernel-state.ts** (lint test).

### Task F2: Merge to main
- [ ] **F2.1: Rebase onto main** + resolve conflicts.
- [ ] **F2.2: Open PR** with body referencing this plan + the contracts spec + the bench receipts.
- [ ] **F2.3: Verify CI green.**
- [ ] **F2.4: Squash-merge or merge-commit** per project convention.
- [ ] **F2.5: Tag the merge** — `git tag canonical-collapse-2026-06-?? -m "Canonical-collapse branch landed; Sprint 1 of contracts roadmap complete."`

---

## What Sprint 2 takes over

When Sprint 1 lands, main has:
- Canonical-only data path (project + ResultStore + EventLog)
- Three typed contracts (TaskContract + DeliverableProvenance + Capability)
- One source of capability truth, source-tagged
- Recency-aware projection invariant pinned
- All historical RA_* flags gone except the four ablation knobs

Sprint 2 picks up: PreFlight enforcement at agent.build(), Bench Honesty Contract (`measured | inconclusive`), and the Phase-A redo with full contracts in measurement-honest substrate. See §6.5 of `05-DESIGN-NORTH-STAR.md`.
