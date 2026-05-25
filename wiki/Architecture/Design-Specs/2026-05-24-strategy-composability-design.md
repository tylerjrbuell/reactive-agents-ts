---
title: Strategy Composability — Incremental Primitive Extraction
date: 2026-05-24
revised: 2026-05-25
status: active — bottom-up primitive extraction (post Phase 0 ship)
owner: Reasoning Team
related:
  - "[[project_composable_strategies]]"
  - "[[project_composable_phases]]"
  - "[[Phase 1 Mechanism Validation Sweep]]"
  - "[[05-DESIGN-NORTH-STAR]]"
target_releases: [v0.12, rolling]
gating: |
  One primitive at a time. Each extraction requires ≥2 live consumers in the
  same PR, a deterministic test suite, an E2-style drift contract, AND a live
  LLM probe (Ollama or frontier) confirming behavior parity or measurable
  lift. Top-down framework synthesis (Trajectory / makeMachine / runStrategy)
  is explicitly deferred until ≥4 primitives exist organically and a shared
  shape becomes self-evident from the primitives themselves.
---

# Strategy Composability — Incremental Primitive Extraction

## Status (revised 2026-05-25 after Phase 0 ship)

**Active — bottom-up primitive extraction.** Phase 0 (`finalize` primitive) shipped on `bundle/strategy-finalize-extraction` with 5-layer evidence: 1338/1338 deterministic tests green, 2 live Ollama probes (with and without real tools), E2 drift contract CI-enforced. See [[#Phase 0 Outcomes (2026-05-25)]].

**Approach revised.** The original v1 of this spec proposed a top-down `Trajectory + StrategyState + makeMachine + runStrategy` framework (Phases 1-5). Post Phase 0, that approach is replaced with **bottom-up incremental extraction** — primitives earn extraction one at a time, on the "code is already open" tax, with mandatory live-LLM evidence per primitive. Top-down framework synthesis is indefinitely deferred. Rationale in [[#Why Bottom-Up, Not Top-Down]] below.

## Goal

Make reasoning strategies **thin** so future strategies can be authored quickly, and make canonical primitives the only place control-flow-agnostic logic lives. Strategies should converge on shared primitives (generate, critique, finalize, decompose, …) and diverge only on the **mechanical control flow** that makes each strategy distinct (single-pass vs multi-pass, tree vs linear, plan-first vs reactive, etc.).

**Definition of "thin":** when a new strategy author starts, ≥70% of the lines they write are control-flow logic specific to their strategy. Plumbing (kernel-invoke, cost accumulation, emit-log, finalize, critique, decompose, etc.) is imported from primitives.

**Definition of "quickly":** measured against actual authors, not predicted. Authoring time becomes evidence only when a new strategy gets authored. Until then, "quickly" is unmeasured aspiration; the primitive surface must earn DX claims through real authoring, not designed-in DX.

## Why Bottom-Up, Not Top-Down

The original v1 spec proposed building `Trajectory + StrategyState + makeMachine + runStrategy + 3 core phases` in one shot, then migrating reflexion (Phase 1), then plan-execute (Phase 2), then 5 more strategies (Phase 3-5). After shipping Phase 0 and re-evaluating, that path fails the stated goal:

1. **Premature primitive shapes.** A primitive's correct API only becomes obvious after ≥2 real consumers force it. Designing `generatePhase`, `critiquePhase`, `decomposePhase` before extraction means guessing at the shape that future strategies need. Half the guesses will be wrong.
2. **Speculative framework.** `Trajectory` + `makeMachine` are the *wrapper* around primitives. Building the wrapper before enough primitives exist = building the assembly line before knowing the parts. Empty `Trajectory` field shapes will get added "because plan-execute might need one" → drift returns.
3. **Big blast-radius commits.** Reflexion + plan-execute rewrites to a new machine framework risks regression on shipping behavior — verified live (Phase 0 tool probe) and worth preserving.
4. **§9 anti-scaffold.** The framework would ship with one consumer per phase (Phase 1 = reflexion alone, Phase 2 = +plan-execute). The Memory v2 Phase v2.0 precedent ([[project_memory_v2_design_drafted]]) shows this pattern stalls.
5. **DX is unmeasurable until measured.** "Quickly composed" can only be tested when a new strategy author tries. Designing for that ergonomic without an author = guessing.

Bottom-up extraction instead:

1. **Each primitive is forced by ≥2 real consumers** (same PR), not designed in vacuum.
2. **Drift contract per primitive** (E2 pattern from Phase 0) makes future duplication a build break.
3. **Live LLM probe per primitive** confirms behavior parity or measurable lift on every extraction — research-grade evidence, not "should work."
4. **Small blast-radius commits.** One primitive, one extraction, two migrations. Rollback is one revert.
5. **Framework emerges if it emerges.** After 4-5 primitives exist organically, their shared shape (cost accumulation, message threading, status transitions) becomes self-evident — and only THEN does `Trajectory` / `makeMachine` get evidence-backed design. May never fire if primitives compose fine without it.

## Phase 0 Outcomes (2026-05-25)

Phase 0 shipped on branch `bundle/strategy-finalize-extraction` in 7 commits. Ran E1 (pre/post correctness) + E2 (drift-prevention contract) + 2 live Ollama probes per the experiment plan in chat 2026-05-25.

### LOC delta

| File | Before | After | Δ |
|---|---|---|---|
| `packages/reasoning/src/strategies/reflexion.ts` | 947 | 838 | **-109 (-11.5%)** |
| `packages/reasoning/src/strategies/plan-execute.ts` | 1642 | 1586 | **-56 (-3.4%)** |
| `packages/reasoning/src/kernel/loop/finalize.ts` | 0 | 159 | +159 (new) |
| **Source net** | **2589** | **2583** | **-6 (essentially neutral)** |
| `packages/reasoning/tests/kernel/loop/finalize.test.ts` | 0 | 238 | +238 (new) |
| `packages/reasoning/tests/strategies/reflexion.test.ts` | (full) | -69 | tests migrated |

Source LOC delta is near-zero because the new shared module + new test coverage offsets the strategy reductions. The win is **structural** (one canonical implementation + drift-locked + thinking-safe upgrade for plan-execute) not byte-count.

### Test delta

| Metric | Before | After |
|---|---|---|
| Reasoning suite total | 1328 pass / 0 fail | **1338 pass / 0 fail** |
| New invariant tests | — | **16** (in `finalize.test.ts`) |
| Build (`bun run build`) | green | **green** (38/38 tasks) |

Breakdown of new tests:
- 6 × `decideSynthesisInput` (migrated from reflexion.test.ts)
- 5 × `collectToolData` (new; KernelMessage filter, error skip, order preservation, empty skip, empty input)
- 3 × `enforceQualityGate` Effect wrapper (new; no-op when no format, no-op when complete, fallback on empty synthesis)
- **2 × drift contract (E2)** — see below

### E2 drift contract (the durable win)

Two structural tests now run as part of the reasoning suite:

1. **"No strategies/*.ts file imports synthesis primitives directly."** Scans every `packages/reasoning/src/strategies/*.ts` for direct named imports of `buildSynthesisPrompt` or `validateContentCompleteness`. Allows imports from `finalize.js`. Future strategy that pulls these in directly fails the test. Today: 0 violations.
2. **"Strategies do not re-implement the gate locally."** Regex-scans for `function enforce(Output)?QualityGate(` definitions in `strategies/*.ts`. Drift class that motivated Phase 0 (3-way duplication) becomes a build break. Today: 0 violations.

**Effect:** dedup is now permanent. Future duplication = CI fail, not silent drift.

### Live LLM verification

- **Probe A** (`apps/examples/src/reasoning/finalize-probe.ts`, qwen3.5:latest, 2026-05-25): format-driven markdown table task. Both strategies completed, produced valid table, zero placeholder leakage. Reflexion 30.3s/2797tok; plan-execute 84.2s/7252tok.
- **Probe B** (`apps/examples/src/reasoning/finalize-probe-tools.ts`, qwen3.5:latest + crypto-price tool → live CoinGecko, 2026-05-25): plan-execute called crypto-price 2× (BTC+ETH), raw CoinGecko JSON threaded through `enforceQualityGate`, output contained real prices ($77,505 / $2,123.49), zero placeholder leakage. Reflexion satisfied task from training (no tool call), so the placeholder-fix branch wasn't live-exercised — unit tests cover that branch deterministically.

### Unexpected findings

- **plan-execute received a strict upgrade.** Its private `enforceOutputQualityGate` used `stripThinking`; the shared module uses `extractThinkingSafeContent` (rescues answers trapped inside `<think>`). Identical on non-thinking models, strictly better on thinking models. Documented at the call site.
- **Source LOC neutral, but reflexion shrank 11.5%.** Plan-execute shrunk less because most of its 1642 LOC is its own control-flow (plan generation, step execution, reflection orchestration). This confirms the bottom-up thesis: most "thin strategy" gain comes from extracting the next 2-3 primitives, not from any single one.

### Phase 0 verdict

**Shipped.** Commits on `bundle/strategy-finalize-extraction`:

- `1f4cf548` — `refactor(reasoning): extract synthesis quality gate to kernel/loop/finalize.ts`
- `c207558f` — `refactor(reflexion): consume shared finalize module`
- `8af80ced` — `refactor(plan-execute): consume shared finalize module`
- `648e3cb2` — `test(finalize): invariant suite + drift-prevention contract`
- `01ed0d49` — `docs(strategy-design): file Phase 0 outcomes`
- `8d09b749` — `test(examples): live ollama probe for finalize.ts + update Phase 0 outcomes`
- `9951246d` — `test(examples): live tool probe (ollama + crypto-price) for finalize.ts`

## Primitive Catalog

This is the live extraction roadmap. Each row = one primitive. Order is **trigger-driven**, not date-driven — extractions happen when the relevant code is already open for another reason. The "Trigger" column is the cheapest "we're touching this code anyway" signal; the "Evidence required" column is the gate that must clear before the primitive merges.

| # | Primitive | Home (proposed) | Candidate consumers | Today's call sites | Trigger to extract | Status |
|---|---|---|---|---|---|---|
| 1 | `finalize` (`enforceQualityGate` / `decideSynthesisInput` / `collectToolData`) | `kernel/loop/finalize.ts` | reflexion, plan-execute, (future ToT, code-action) | shipped — 1 home | — | ✅ **shipped 2026-05-25** |
| 2 | `critique` (LLM-as-judge pass: prompt + thinking extraction + stagnation check) | `kernel/capabilities/verify/critique.ts` | reflexion (`buildCritiquePrompt` + `extractThinking`), plan-execute-reflect (`buildReflectionPrompt` + `stripThinking`) | reflexion.ts ~line 250-280; plan-execute.ts ~line 690-720 | next time either reflect/critique prompt edited | pending trigger |
| 3 | `runPass` (kernel-invoke + cost accumulation + step harvest into a pass record) | `kernel/loop/run-pass.ts` | reflexion (3 invocations), plan-execute (per-step), ToT (per branch), code-action (verifier loop) | duplicated cost/step accumulation in every strategy | next time a strategy adds another invocation point | pending trigger |
| 4 | `decompose` (Task → Plan/Branches) | `kernel/capabilities/comprehend/decompose.ts` | plan-execute (`buildPlanGenerationPrompt`), ToT (expand), sub-agent delegation | plan-prompts.ts; ToT branching | next time plan generation prompt edited | pending trigger |
| 5 | `costAccumulator` (tokens + USD across passes) | likely subsumed by #3 | all strategies | inline `let totalTokens = 0; totalCost = 0;` in 7 files | extract as part of #3 | pending trigger |
| 6 | `thinkingExtraction` contract (single helper, documented when-to-use rules for `stripThinking` / `extractThinking` / `extractThinkingSafeContent`) | `kernel/capabilities/reason/stream-parser.ts` (consolidate) | 5 call sites today across 3 strategies | grep `stripThinking\|extractThinking\|extractThinkingSafeContent` | next thinking-model regression OR next time a helper is added | pending trigger |

### Per-primitive evidence gate (mandatory template)

Every primitive extraction MUST clear all 6 gates below before merging. The Phase 0 ship is the reference implementation of this template.

1. **≥2 live consumers in the same PR.** No "framework with one consumer." Migrate ≥2 strategies in the same PR that introduces the shared module.
2. **Deterministic unit tests** for the primitive's pure-logic surface (≥6 tests covering the branching rules + edge cases). Located at `packages/reasoning/tests/kernel/<path>/<primitive>.test.ts`.
3. **E2 drift contract.** ≥1 grep-/AST-based test asserting no `strategies/*.ts` file may re-implement the primitive locally OR import the primitive's underlying parts (synthesis prompts, judge prompts, etc.) outside the canonical home.
4. **Live LLM probe (Ollama tier minimum).** `apps/examples/src/reasoning/<primitive>-probe.ts` that exercises both migrated strategies against a real model. Assert: no crash, behavior parity or measured lift, no regression on any output-quality signal the primitive controls.
5. **Live tool probe (when applicable).** If the primitive affects tool-data threading (any data-handling primitive), an additional probe using a real built-in tool (e.g. `crypto-price`, `web-search`) or MCP server.
6. **Source LOC delta + test delta logged in this spec** under a new `## Primitive #N Outcomes` heading. Honest about wins and non-wins (Phase 0 was source-neutral because new tests/module offset the strategy reduction — that is the kind of honesty required).

### Anti-extraction (do NOT extract)

| Symbol | Why solo |
|---|---|
| ToT's `expand` / branch-scoring | tree-branching specific, no 2nd consumer |
| code-action's `sandboxPhase` | verifier-loop specific, no 2nd consumer |
| adaptive's `routePhase` | classifier specific, no 2nd consumer |
| `runKernel` / `reactKernel` | already the kernel boundary — strategies invoke kernel, not the other way around |
| any helper used in only 1 strategy | §9 — single-consumer extraction creates premature primitives |

Rule: a primitive earns extraction only when ≥2 real strategies have the SAME shape. Conceptual similarity doesn't count.

## Speculative emergence (the framework that may never need to ship)

After primitives 2-5 land (if they land), one of two outcomes is likely:

### Outcome A: composition is fine, no framework needed

Strategies are 5 imports + 100-200 lines of strategy-specific control flow each. New strategy authoring takes a day. The primitives are the platform. `Trajectory` / `makeMachine` never get built because they wouldn't add anything composition + the primitives don't already provide. **This is the success case.**

### Outcome B: shared shape becomes self-evident

The 4-5 primitives all need the same trajectory accumulator (cost + messages + steps + passes), the same status dispatch model, the same hooks. The shape is so consistently re-needed that not extracting it becomes the duplication problem.

If Outcome B, THEN — and only then — a Phase X gets written for `Trajectory` + `makeStrategy`. By that point the shape is forced by real primitives, not designed in vacuum. Estimated lift, contract, and live-probe template all carry over from earlier phases.

**Today's commitment: neither outcome is predicted.** Primitive 2 fires when its trigger fires. Re-evaluate after.

## Stop conditions (per primitive)

A primitive extraction is wrong and should be reverted if:

- Live LLM probe shows regression on any quality signal the primitive controls.
- Either migrated strategy's deterministic tests fail or regress in count.
- The primitive's shape forces awkward call-site contortions in either consumer ("we needed a 3rd parameter for strategy X only" → primitive shape is wrong).
- The E2 drift contract has to be weakened to allow exceptions (means the primitive isn't actually canonical).
- Build red after extraction.

Hitting any of these reverts the extraction commit and re-opens the primitive for redesign before the next attempt.

## Stop conditions (for the whole approach)

The bottom-up extraction approach itself is wrong if:

- After 3-4 primitives land, the strategy files have not measurably thinned (target: ≥30% LOC reduction in the migrating strategies cumulatively). If primitives don't shrink strategies, the wrong things are being extracted.
- A primitive needs to be removed (consumer count drops to 1) — means it was extracted too early.
- Drift contract has to allow ≥2 exemptions across the catalog — invariant centralization has failed.

Any of these triggers a stop + re-evaluate.

## What this design does NOT do

- Does NOT build `Trajectory` / `StrategyState` / `makeMachine` / `runStrategy` now. Possibly never.
- Does NOT pre-design primitive shapes before extraction. Each primitive's API is forced by its ≥2 consumers in the migration PR.
- Does NOT promise per-strategy DX improvements until a new strategy is authored and timed.
- Does NOT add JSON/YAML strategy specs. Ever.
- Does NOT add composition operators (parallel/race/sub-strategy) unless a real strategy needs them.
- Does NOT migrate strategies for the sake of migration — extractions happen on the "code is already open" tax, not on a date schedule.

## Integration with existing systems (carries forward, unchanged)

- **HarnessPipeline** (`packages/core/src/services/harness-pipeline.ts`) — primitives that emit events use the existing pipeline. No new bus.
- **KernelHooks** (`packages/reasoning/src/kernel/state/kernel-hooks.ts`) — primitives extend existing hooks where relevant; no parallel hook surface.
- **Replay package** (`@reactive-agents/replay`) — primitives produce serializable data by default; replay falls out free.
- **Strategy switching (M2)** — orthogonal to this design; lives in the runner.

## Outstanding process gaps

- `architecture-audit` and `effect-abstraction-audit` skills were not run before Phase 0 ship. Skipped intentionally — Phase 0 was small and behaviorally identical. **Mandatory** before primitive #2 (`critique`) merges, since #2 involves shared LLM prompts where audit findings would materially shape the API.
- No new strategy author has tried to author a strategy against the primitive set yet. Until they do, the DX claims in this spec are unverified.

## References

- Phase 0 commits: `1f4cf548..9951246d` on `bundle/strategy-finalize-extraction`
- Phase 0 live probes: `apps/examples/src/reasoning/finalize-probe.ts`, `apps/examples/src/reasoning/finalize-probe-tools.ts`
- Reflexion synthesis-gate fix (origin of the whole thread): commit `0af217c8` (2026-05-24)
- Kernel composability shipped: [[project_composable_phases]] (Apr 3, 2026)
- Composable strategies V1.1 intent: [[project_composable_strategies]]
- Phase 1 mechanism validation findings: [[project_self_improving_harness]]
- North Star §9 Anti-Scaffold: [[05-DESIGN-NORTH-STAR]]
- Memory v2 §9 precedent: [[project_memory_v2_design_drafted]]
- Original v1 of this spec (top-down framework approach): superseded by this revision; see git history `git log --follow wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md`
