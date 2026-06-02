---
title: Canonical Contracts & Invariants — completing the canonical harness with structural guarantees
date: 2026-06-02
branch: overhaul/agentic-core-2026-05-31
status: design-spec (proposed) — the typed-contract layer that completes the canonical architecture
position: COMPLEMENTS canonical-harness-core (mechanisms) + canonical-context-assembly (data flow); ADDS the typed contract surface those mechanisms must enforce
references:
  - "[[2026-05-31-canonical-harness-core]]"                   # the 5 mechanism parts (reducer loop, projection, capability spine, verification, masked tools)
  - "[[2026-05-31-canonical-context-assembly]]"               # ONE event log + content-addressed store + pure project()
  - "[[2026-06-01-canonical-collapse-revalidation-and-branch-closure]]"  # ADOPT verdict + Phase A bench
  - "wiki/Architecture/Specs/06-MISSION-STATEMENTS.md"        # 8 pillars / 10 capabilities / falsifiable missions
  - "wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md"         # north-star v5.0
purpose: "Codify the typed contracts and structural invariants that the canonical harness must enforce — so the failure modes we keep flip-flopping between become STRUCTURALLY impossible rather than continually re-fixed. The existing specs lay down the mechanism shape; this spec is what those mechanisms must guarantee."
evidence-anchor: "Phase-A 2026-06-02 triage session — 7 cascading bugs (deliverable-leak, tier mis-resolution, file-read invisibility, recall coercion, recencyBudget/preserve conflation, lazy-classifier non-determinism, requiresTools boolean ambiguity). Each one matches an unnamed invariant. None would have shipped if these invariants were load-bearing types."
---

# Canonical Contracts & Invariants

> The canonical architecture already has the **data-flow shape** (one event log + content-addressed store + pure projection). It does not yet have the **typed-contract shape** that mechanically enforces what "canonical" means at every system boundary. That is the gap this spec closes.

## §1 — Why this spec exists

The 2026-06-02 Phase-A triage session shipped a useful but exhausting realization. Over six hours we hit seven distinct bugs:

| # | Symptom | What was actually broken | What we were missing |
|---|---|---|---|
| 1 | Output text = `"Tool call used unavailable name(s)..."` | dispatch-rejection observation passed `getDeliverableObservationContent` fall-through | a **typed deliverable channel** that rejects non-validated observations by construction |
| 2 | `qwen3.5:latest` resolved to `tier:"mid", window:2048` | `tierFromModelName` regex misses `Nb`-less names + `STATIC_CAPABILITIES` lacked the entry | a **single capability resolver** that surfaces "fallback" loudly |
| 3 | `file-read` absent from LLM schema despite task with `report.md` fixture | `withTools()` filters builtins by default; bench tasks declare `requiresTools: true` (boolean), not WHICH tools | a **typed task contract** linking declared needs to required exposures |
| 4 | `recall` tool dropped `full` flag every call | `qwen3.5` emits `"full":"true"` (string); validator type-mismatched | a **boundary-coercion invariant** at every external input edge |
| 5 | Project arm 14471 tok vs legacy 4854 tok on summarize | `recencyBudgetChars` (window×0.35×4 = 45875) reused as per-result preservation gate (38× over-permissive) | **separation of concerns at the type level** — one budget for "recency window total," a different one for "per-result preservation cap" |
| 6 | `file-read` nondeterministically invisible (one run) | LLM-based classifier output racing the `RA_LAZY_TOOLS=1` gate | a **classifier honesty contract** — classifier output must be inspected as a typed signal, not a silent prune |
| 7 | Tightening preserve cap regressed transcribe 100→0% | Flat per-result cap stripped verbatim content from the SOLE/latest result | a **recency-aware projection invariant** in the type system, not a tunable heuristic |

**Common shape across all seven:** *a mechanism made a reasonable local choice that silently breaks at a system boundary.* The MOST EXPENSIVE part of each was not the fix — it was deciding which mechanism was at fault. Hours of bisecting cascading symptoms across multiple competing hypotheses.

The pattern is structural. The same shape will surface tomorrow under a different name. We keep flip-flopping because we keep fixing symptoms; the invariants that would prevent them remain tribal knowledge.

### The diagnosis

The existing canonical specs (`canonical-harness-core` + `canonical-context-assembly`) define:
- **What the canonical mechanisms are** — one reducer loop, one assembler, one capability spine, one verifier, one masked tool surface
- **What the canonical data flow is** — one event log + content-addressed `ResultStore` + pure total `project(log, capability, store)`

Both layers are necessary. Neither is sufficient. **The missing piece is the typed contract surface at every boundary the mechanisms cross.** Without it:
- Task → Tool boundary leaks (no `TaskContract.tools` type)
- Model → Capability boundary leaks (no `CapabilitySource` discriminator)
- Observation → Deliverable boundary leaks (no `DeliverableProvenance` union)
- Capability → Projection boundary leaks (no separation between "window-fits" and "attention-fits")
- Builder → Run boundary leaks (no pre-flight contract check)

Each leak is a quiet correctness gap. Together they make the framework brittle in exactly the way `04-PROJECT-STATE.md` and the mission statements warned about.

The vision says *"every decision an agent makes should be controllable, observable, and auditable."* That requires **every boundary in the framework to be a typed contract whose violation is impossible to construct at compile time or impossible to ignore at run time.**

---

## §2 — The five canonical contracts

Each contract below is:
- **Typed** — a TS shape that exists at compile time, not a runtime convention
- **Single-sourced** — produced and consumed by exactly one channel
- **Enforced** — by a mechanism that fails loudly when violated
- **Tested** — pinned by tests so future drift is a CI failure

### §2.1 — `TaskContract` — what the agent must be able to do

**Problem this solves:** today a bench task says `requiresTools: true` (boolean) and `fixtures: [{path, content}]`. The bench runner has to guess what tools the task needs. We guessed wrong and the model could not read its own fixtures.

**Type shape (target):**
```ts
// packages/core/src/contracts/task-contract.ts
export interface TaskContract {
  /** The agent's prompt — preserved verbatim. */
  readonly prompt: string;

  /** Tools the task DECLARES it needs. Builder validates. */
  readonly tools: readonly ToolRequirement[];

  /** Fixture files that must be readable at run time. */
  readonly fixtures?: readonly FixtureContract[];

  /** Minimum model capability the task expects. */
  readonly modelFloor?: {
    readonly window?: number;       // chars of effective context, NOT claimed
    readonly thinking?: boolean;    // requires native thinking-mode
    readonly nativeFC?: boolean;    // requires native function-calling
  };

  /** Success oracle — either a pure predicate or a verifier dimension. */
  readonly success: SuccessCriterion;

  /** Optional shaping for the deliverable. */
  readonly outputShape?: OutputContract;
}

export type ToolRequirement =
  | { readonly kind: "required";  readonly name: string }   // must succeed at least once
  | { readonly kind: "available"; readonly name: string }   // must be visible to model
  | { readonly kind: "forbidden"; readonly name: string };  // must NOT be visible

export interface FixtureContract {
  readonly path: string;
  readonly content: string;
  /** Tool capability the fixture implies (defaults: file-read for any fixture). */
  readonly readableVia?: readonly string[];
}
```

**Enforcement:**
- `agent.build()` calls `validateTaskContract(contract, builderState)`. If any required tool isn't registered in the ToolService AND visible in the prompt-facing schema, build FAILS with `TaskContractViolation { kind: "tool-not-exposed", tool, declared, exposed }`.
- Bench runner derives `tools: ["file-read"]` from any task with `fixtures` automatically. Tasks may also declare explicit tools to override.
- Bench `runInternal` checks contract BEFORE invoking the model — refuses to measure a cell where the contract can't be honored.

**Bug this would have caught (#3 + #7):** `cs-overflow-*` would declare `tools: ["file-read"]`. Runner would have exposed file-read on day one. The Phase-A bench measurement that confused everyone for a session would have surfaced the real arm-level signal immediately.

**Mission tie-in:** Pillar 1 (Control), §3 of `06-MISSION-STATEMENTS.md` (Comprehend mission: "Every task produces a `ComprehendResult` with required-tools, soft-required-tools, format-hints, complexity-class fields").

### §2.2 — `Capability` — one source of model truth, source-tagged

**Problem this solves:** today there are SIX entry points to model capability resolution:
1. `packages/reasoning/src/context/context-profile.ts` — `CONTEXT_PROFILES[tier]`
2. `packages/llm-provider/src/capability.ts` — `STATIC_CAPABILITIES["provider/model"]`
3. `packages/reasoning/src/context/profile-resolver.ts` — `resolveProfile()` / `tierFromModelName()`
4. `packages/llm-provider/src/capability-resolver.ts` — `resolveCapability()` (different function, different package, same name)
5. `packages/reasoning/src/assembly/capability.ts` — `resolveCapability()` (a third function with the same name, takes `CapabilityInput`)
6. `packages/llm-provider/src/providers/local-probe.ts` — `probeOllama()` for live probe

Six entry points = six places to drift. We landed in `tier:"mid", window:2048` for `qwen3.5:latest` because:
- entry (1) defaulted to `mid` (regex missed `Nb`-less names)
- entry (2) had no `qwen3.5:latest` row → conservative fallback fired silently
- entry (3) wraps (1) but doesn't surface the fallback warning
- entry (5) is a NEW resolver we built for assembly that doesn't talk to (4)
- entry (6) probe path isn't wired by default (deferred to S2.4)

**Type shape (target):**
```ts
// packages/core/src/contracts/capability.ts
export type CapabilitySource =
  | "probe"           // live model probe (highest trust)
  | "cache"           // probed previously, replayed from cache
  | "static-table"    // hand-curated entry in STATIC_CAPABILITIES
  | "fallback";       // generic conservative default (LOWEST trust)

export interface Capability {
  readonly provider: ProviderName;
  readonly model: string;

  /** Effective context (chars). Already accounts for ~65% of claimed window
   *  per Chroma `Context Rot` + NVIDIA `RULER`. Single number, all consumers. */
  readonly effectiveWindowChars: number;

  /** Recommended num_ctx the provider should be configured with. */
  readonly recommendedNumCtx: number;

  readonly tier: Tier;
  readonly dialect: "native-fc" | "text-parse" | "none";
  readonly supports: {
    readonly thinking: boolean;
    readonly streamingToolCalls: boolean;
    readonly promptCaching: boolean;
    readonly vision: boolean;
  };

  /** Provenance — the trust signal. */
  readonly source: CapabilitySource;
}

export interface CapabilityResolver {
  resolve(provider: ProviderName, model: string): Capability;
}
```

**Enforcement:**
- Exactly one `CapabilityResolver` instance in the workspace. The two `resolveCapability` functions in two packages merge into one. The `CONTEXT_PROFILES` table merges with `STATIC_CAPABILITIES` (one table, tier-aware fields).
- Consumers (think.ts, project.ts, ollama provider's num_ctx setter, bench runner) read from this resolver. Direct construction of capability shapes outside the resolver is a lint failure.
- When `source === "fallback"`, the resolver emits a STRUCTURED WARNING event (not a `console.warn`). The bench refuses to record a measurement when this fires unless explicitly opted in.

**Bug this would have caught (#2):** the qwen3.5:latest fallback would have surfaced as `[capability:source-fallback]` event. The bench would have refused to score. Six hours of confusion → 5-second diagnostic.

**Mission tie-in:** Pillar 7 (Scalability) — "≤10 mutation sites total across the kernel"; Pillar 2 (Observability) — "every state transition has a typed trace event."

### §2.3 — `DeliverableProvenance` — one channel into `state.output`

**Problem this solves:** today `state.output: string | null`. Any code path can mutate it. We've fixed three "errors leaked into output" bugs in three months. The structural cause is: there's no type distinguishing "this string came from the model thinking through the problem" from "this string is a dispatch-error message that happened to be in scope."

**Type shape (target):**
```ts
// packages/core/src/contracts/deliverable.ts
export type Deliverable =
  | { readonly source: "model_synthesis"; readonly thought: ThoughtStep; readonly chars: number }
  | { readonly source: "tool_artifact"; readonly observation: ValidatedObservation }
  | { readonly source: "harness_synthesis"; readonly assembled: readonly ValidatedObservation[]; readonly synthesisCall: LLMRoundTripRef }
  | { readonly source: "sentinel"; readonly reason: "no_substantive_output" | "max_iterations_no_artifacts" };

export interface ValidatedObservation {
  /** Discriminator — only observations carrying this shape can become deliverables. */
  readonly _validated: "tool-success";
  readonly toolName: string;
  readonly callId: string;
  readonly content: string;
  /** The tool MUST be in state.toolsUsed AND its dispatch MUST have returned success===true. */
  readonly invariant: { readonly success: true; readonly toolInState: true };
}

// The single channel into state.output:
export function commitDeliverable(state: KernelState, d: Deliverable): KernelState {
  // type system forces the caller to construct a Deliverable.
  // No raw strings can land here.
}
```

**Enforcement:**
- `state.output` setter is private; only `commitDeliverable()` writes to it.
- `ValidatedObservation` is produced ONLY by the tool-dispatch happy path. Dispatch-rejection observations are tagged `{kind: "tool-rejection"}` and cannot be widened to `ValidatedObservation`. The type system rules out the deliverable-leak class.
- The 2026-06-02 fix at `deliverable.ts:120-130` (strict `observationResult.success === true` gate) becomes a type-level guarantee, not a runtime filter.

**Bug this would have caught (#1):** the dispatch-rejection observation could not have been typed as `ValidatedObservation`. The leak would have been a compile error.

**Mission tie-in:** Pillar 5 (Reliability) — "≥99% of probe corpus terminates through Arbitrator. Zero out-of-Arbitrator termination paths"; Trust differentiator (FM-E1).

### §2.4 — `Projection` — recency-aware, two budgets, never conflated

**Problem this solves:** today `recencyBudgetChars` was overloaded for two semantically different jobs:
- "Total recency-window budget" (governs `compactHistoryStage`)
- "Per-result preservation cap" (governs `projectResultsStage`)

The two have wildly different correct values (legacy mid tier: 32K window total vs 1200 chars per-result). Conflating them gave us 38× over-permissive per-result gates and the Phase-A token bloat.

The 2026-06-02 fix split them, then split the per-result gate further into recency-aware (latest = full, older = preserve cap). That fix is the right shape — codify it as a contract.

**Type shape (target):**
```ts
// packages/core/src/contracts/projection.ts
export interface ProjectionPolicy {
  /** Total recency-window budget for the assembled thread. compactHistoryStage. */
  readonly recencyBudgetChars: number;

  /** Per-result preservation cap for OLDER tool results. Aggressive compression. */
  readonly olderResultPreserveBudget: number;

  /** Per-result preservation cap for the LATEST tool result. Generous — this is
   *  what the model is acting on NOW. */
  readonly latestResultPreserveBudget: number;

  /** Aged content budget (the truly old turns). */
  readonly agedBudgetChars: number;
}

export function projectionPolicy(cap: Capability): ProjectionPolicy {
  // single derivation site; all budgets are fractions of cap.effectiveWindowChars
  // per `canonical-collapse-revalidation` §1 (LangChain Deep Agents / OpenAI
  // truncation-auto / Mastra: budgets must be %-of-effective-window).
}
```

**Enforcement:**
- `projectResultsStage` reads from `ProjectionPolicy`, not directly from `Capability`. No call site can confuse the two budgets.
- The recency-aware split (latest = `latestResultPreserveBudget`, older = `olderResultPreserveBudget`) is the contract. Pinned by tests.
- Tier-aware defaults: legacy's `toolResultMaxChars` table becomes the older-result cap; latest-result cap is more generous (effective-window fraction).

**Bug this would have caught (#5 + #7):** the recencyBudget conflation would have been a compile error (different types, can't be substituted). The flat-cap regression on verbatim tasks would have been impossible to write — the type forces you to pick "older" vs "latest."

**Mission tie-in:** Pillar 6 (Efficiency) — "intervention only when its intervention has measurable lift"; canonical-context-assembly Pillar 4 ("every budget is a function of `ResolvedCapability`").

### §2.5 — `PreFlight` — contract validation at `agent.build()`

**Problem this solves:** today bugs surface mid-run as observable symptoms. They should surface at build time as structured errors.

**Type shape (target):**
```ts
// packages/core/src/contracts/preflight.ts
export interface PreFlightReport {
  readonly violations: readonly PreFlightViolation[];
  readonly warnings: readonly PreFlightWarning[];
}

export type PreFlightViolation =
  | { readonly kind: "task-contract"; readonly issue: TaskContractIssue }
  | { readonly kind: "capability-floor"; readonly required: ModelFloor; readonly resolved: Capability }
  | { readonly kind: "capability-source"; readonly source: "fallback"; readonly remedy: string }
  | { readonly kind: "tool-missing"; readonly required: string; readonly registered: readonly string[] }
  | { readonly kind: "deliverable-channel"; readonly issue: string };

export function preflightCheck(
  builder: ReactiveAgentBuilder,
  task?: TaskContract,
): PreFlightReport;
```

**Enforcement:**
- `agent.build()` runs preflight. Violations → throw with structured error. Warnings → emit + continue.
- Bench harness runs preflight per cell. Violations → record the cell as `inconclusive: { reason: PreFlightViolation }`, not as a score.

**Bug this would have caught (#2 + #3):** capability source = fallback would have failed preflight unless the test caller opted in. Tool-not-exposed would have failed preflight.

**Mission tie-in:** all 8 pillars — the preflight check is the gate that asserts "this run can honor the contracts."

---

## §3 — The five canonical invariants

Mechanism-level: what the framework guarantees, mechanically enforced. Each is the system-level shape of the contracts.

| # | Invariant | Mechanism that enforces | Test pin | Failure mode prevented |
|---|---|---|---|---|
| **I1** | One reducer loop. `reduce(log, capability) → next_action` is the sole loop. Strategies = reducer policies. | `kernel/loop/runner.ts` is the only loop. Strategy adapters return policy decisions, not parallel kernels. | Test: every reasoning strategy passes through `runner.ts` (zero out-of-loop paths). | "Strategy bypasses kernel" — F1 anti-pattern, already mitigated, codify as invariant. |
| **I2** | One assembler. `project(log, capability, store) → request` is the only message-thread builder. | `assembly/project.ts`. Legacy `curate()` deleted in canonical-collapse §2 deferred step. | Test: every LLM round-trip's request comes from `project()`. | Maze of parallel assemblers. |
| **I3** | One deliverable channel. `state.output` is set only via `commitDeliverable(state, Deliverable)`. | `DeliverableProvenance` discriminated union; `state.output` setter private. | Test: every termination path constructs a `Deliverable` value. | Dispatch errors leaking as output (bug #1). |
| **I4** | One capability resolver, source-tagged. Single `CapabilityResolver` instance; `Capability.source` exposes provenance. | `packages/core/src/capability/resolver.ts`. The 6 entry points merge. | Test: capability table covers all bench models; fallback fires only on intentional unknown. | Tier/window drift (bug #2); silent fallback (general). |
| **I5** | Recency-aware projection. Latest tool_result uses `latestResultPreserveBudget`; older uses `olderResultPreserveBudget`. Budgets are %-of-effective-window. | `assembly/stages/project-results.ts` (already implemented 2026-06-02). | Test: pinned in `tests/assembly/project-results.test.ts` recency-split test. | Token bloat (bug #5); verbatim-task regressions (bug #7). |

Two more invariants to graduate later (Phase B+):

| # | Invariant | Phase |
|---|---|---|
| **I6** | Boundary coercion. External inputs (LLM-emitted tool args, MCP responses, env vars) are coerced to declared types at the boundary; type-strict afterwards. | B (after current per-tool ad-hoc coercion centralizes — bug #4) |
| **I7** | Classifier honesty. LLM-based classifier output is a TYPED SIGNAL (`ClassifierResult { tools, confidence, source }`), not a silent prune. Lazy-disclosure consumes the signal but never silently drops a fixture-required tool. | B (after `TaskContract.tools` lands; classifier's role becomes "soft hints" not "hard prune") |

---

## §4 — Failure-mode → invariant matrix (this session's bugs)

Every bug we hit this session, mapped to the invariant that would have prevented it. If the matrix shows an empty cell, the invariant set is incomplete.

| Bug (2026-06-02) | TaskContract | Capability | DeliverableProvenance | Projection | PreFlight |
|---|:---:|:---:|:---:|:---:|:---:|
| #1 dispatch-error as output | | | ✓ | | |
| #2 qwen3.5 tier=mid window=2048 | | ✓ | | | ✓ |
| #3 file-read invisible | ✓ | | | | ✓ |
| #4 recall "true" string coercion | | | | | (I6 future) |
| #5 recencyBudget conflation → 27% token bloat | | | | ✓ | |
| #6 lazy-classifier drops file-read | ✓ | | | | (I7 future) |
| #7 flat preserve cap regresses transcribe | | | | ✓ | |

Coverage: 5 of 7 covered by the 5 launched contracts. 2 deferred to Phase B (I6/I7). **Every bug maps to a missing structural invariant.** None of them were "we made the wrong call"; all of them were "the framework didn't catch what canonical means at this boundary."

---

## §5 — Migration plan (how to land this without flip-flopping)

The temptation: ship five contracts simultaneously. That's how mazes are born. The discipline: **strangler-fig per contract, bench-validated, one at a time**, mirroring `canonical-harness-core` P1.

### Phase α — Foundations (one PR each, days)
1. **TaskContract type** under `packages/core/src/contracts/`. No consumers yet. Tests pin the shape.
2. **DeliverableProvenance type** + `commitDeliverable()`. Migrate `state.output` mutations one path at a time. Last to migrate: rescue paths. Tests pin: `state.output` cannot be set without a `Deliverable` value.
3. **Capability resolver consolidation.** Single `packages/core/src/capability/resolver.ts`. Existing 6 entry points become deprecated re-exports. The `qwen3.5:latest` row + the Nb-less name fallback both surface "fallback" loudly.
4. **ProjectionPolicy type** wrapping today's two-budget split. `project-results.ts` reads `ProjectionPolicy` only.
5. **PreFlight pass** at `agent.build()`. Initial scope: capability source-fallback + tool-not-exposed.

Each Phase-α change is **net-zero behavior** unless an existing bug surfaces. The contracts don't add behavior; they encode existing intent.

### Phase β — Wire bench to contracts (days)
- Bench session declares `TaskContract`s for every task.
- Bench runner derives required tools from contracts. The "file-read not exposed" class becomes impossible.
- Bench preflight refuses to score cells where capability source == fallback OR contract violation.
- Bench output labels measurements that hit preflight violations as `INCONCLUSIVE`, never as a number.

### Phase γ — Codify the deferred fixes (weeks)
- **I6 boundary coercion** — centralize the LLM-emitted-arg coercion currently scattered across tools.
- **I7 classifier honesty** — classifier becomes a typed signal feeding the same `RA_LAZY_TOOLS` gate, but never able to override a `TaskContract.tools` requirement.
- Per-mechanism cleanup: each remaining inline contract enforcement (`getDeliverableObservationContent`'s strict check, etc.) migrates to type-level enforcement.

### Phase δ — Delete the maze (after aggregate live win, per canonical-harness-core P1)
- Legacy `curate()` deleted (canonical-collapse §2 deferred step).
- Legacy `CONTEXT_PROFILES` table merged into the single resolver.
- Old capability entry points removed.
- `RA_OVERHAUL`, `RA_ASSEMBLY`, `RA_RECENCY_BUDGET_CHARS` flags become defaults; `RA_TOOL_RESULT_BUDGET_CHARS` stays as the ablation knob.

The discipline preserved from `canonical-harness-core`: **deletion only after aggregate live win**. The contracts ride alongside the legacy paths until the bench proves the canonical path is at-least-as-good cross-tier.

---

## §6 — Bench honesty contract

The 2026-06-02 session's six-hour confusion was caused by **the bench reporting a number when the measurement was invalid**. The contracts above let us prevent this structurally.

**Bench Honesty Contract:**
```ts
export interface BenchCellOutcome {
  readonly cell: { task: TaskContract; arm: HarnessVariant; tier: Capability };
  readonly result:
    | { readonly kind: "measured"; readonly score: number; readonly tokens: number; readonly trace: TraceRef }
    | { readonly kind: "inconclusive"; readonly reason: PreFlightViolation | RunFailure };
}
```

Rules:
- A cell that hits a preflight violation produces `inconclusive`, not a 0% score.
- Aggregate stats refuse to compute over cells with `inconclusive` results unless explicitly told to.
- `compareCohorts` reports inconclusive counts as a top-level field, not buried in metadata.
- A bench report that has ANY inconclusive cell is flagged as "PARTIAL MEASUREMENT" — equal-or-better invariant cannot be evaluated until all cells are conclusive.

**Bug this would have caught:** the 2026-06-02 "Phase-A exit gate FIRED in the wrong direction" headline would have been `inconclusive: capability-source-fallback × 24 cells` — zero ambiguity about what was being measured.

---

## §7 — Measurement (how we know contracts hold)

Three altitudes, mirroring the existing success-metrics ladder in `06-MISSION-STATEMENTS.md` §L1-L3.

### L1 — Structural (always green, CI-gated)
- Every contract has a TS type + at least one pin test
- Lint rules: no direct `state.output` mutation; no direct `CONTEXT_PROFILES[tier]` reads; no `recencyBudgetChars` consumed by per-result projection
- Build fails if `packages/core/src/contracts/` exports change without corresponding tests

### L2 — Observability (every bench run, automated)
- 100% of `state.output` writes carry a `Deliverable.source` trace event
- 100% of capability resolutions emit `capability:source-{probe,cache,static-table,fallback}` events
- 100% of bench cells emit `BenchCellOutcome` with explicit `measured | inconclusive`

### L3 — Outcome (quarterly, bench-anchored)
- **Failure-mode recurrence rate** — track how many bugs are filed against the 5 invariants. If a category (e.g., "dispatch error as output") recurs after the invariant lands, the invariant is broken; investigate.
- **Bench inconclusive rate** — should approach zero as contracts spread. Rising inconclusive rate = contracts are detecting more silent gaps that used to slip through as bogus scores.
- **Phase-A redo time** — the 2026-06-02 session took six hours to surface the real signal. After contracts, the same investigation should take minutes.

---

## §8 — What this spec deliberately is NOT

- **Not a strategy redesign.** Strategy compose API (`packages/compose/`) is orthogonal.
- **Not a memory v2 redesign.** Memory contract is its own initiative (`2026-05-23-memory-v2-design.md`).
- **Not an MCP/tool-registry refactor.** Tool-side contracts live here in a future phase; today's spec assumes the existing `ToolDefinition` shape.
- **Not a replacement for `06-MISSION-STATEMENTS.md`.** This spec gives the missions their typed contracts; the missions remain the WHY/SHOULD-BE.

---

## §9 — Open risks

1. **Contract proliferation.** Five contracts today; if we don't gate new contracts with the same Pruning Principle that gates new mechanisms, we'll be back here in three months with twelve. Discipline: a new contract requires evidence of ≥2 distinct bug classes it would prevent.
2. **Phase α net-zero claim.** Migrating `state.output` mutations to `commitDeliverable()` will touch every termination path. Risk: one path migrated wrong = new bug. Mitigation: bench cross-tier per contract migration.
3. **Capability-resolver merge.** The 6 entry points have subtly different semantics. Merging them is a multi-week refactor. Phase-α order matters: do it AFTER the bench can measure regressions on capability resolution.
4. **Lint enforcement.** "Cannot directly read `CONTEXT_PROFILES[tier]`" needs a lint rule. Effort is small; discipline of writing/maintaining lint rules is what often slips.

---

## §10 — Next action

This spec is the DESIGN. The IMPLEMENTATION starts with:

1. **One advisor pass** on this spec before any code lands (the canon: review the design before writing the code).
2. **Phase-α task #1 only** — `TaskContract` type + bench tasks migrate to declare `tools`. The smallest concrete step that proves the contract pattern works under the equal-or-better invariant.
3. **Phase-A redo** — once the contract-aware bench is online, re-run cs-overflow-* cells. If the recency-split projection design (2026-06-02 fix) holds under contract-aware measurement, declare Phase A complete and move to Phase B per `canonical-harness-core`.

---

## §11 — Closing — the structural claim

The framework's mission is *"reliable, observable, composable agent behavior across any model tier, with every decision auditable to its source signal."* The canonical-architecture work this branch represents got the DATA-FLOW canonical. The contract layer above gets the BOUNDARIES canonical.

When both layers land, the failure modes we've been flip-flopping between will not return — not because we'll be more careful, but because they will be **structurally impossible to construct**. That is what "canonical" must mean.
