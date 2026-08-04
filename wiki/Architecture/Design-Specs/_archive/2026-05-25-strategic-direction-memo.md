---
title: Strategic Direction Memo — Closing the Vision Gap (2026-05-25 → v1.0)
date: 2026-05-25
status: direction-setting (not a build plan; sequences existing North Star objectives by leverage)
owner: Architecture
adoption_context: 10 stars / 1.1k NPM downloads — pre-PMF, rewrite permission is HIGH
companion-required-reading:
  - "wiki/Architecture/Specs/00-VISION.md"
  - "wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md"
  - "wiki/Architecture/Specs/06-MISSION-STATEMENTS.md"
  - "wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md"
  - "[[2026-05-25-framework-composition-vision]]"
  - "[[2026-05-24-strategy-composability-design]]"
---

# Strategic Direction Memo — Closing the Vision Gap

## Why this document exists

The framework has 5 authoritative architecture docs (Vision, North Star v5.0, Mission Statements, Optimal Execution Algorithm, Convergence Spec) PLUS a vision doc I drafted yesterday (`2026-05-25-framework-composition-vision`). Direction is over-documented; **execution leverage is under-articulated**.

This memo: read the docs, find the gap between what they say the framework should be and what the code currently is, identify the **minimum set of architectural moves** that close the gap with the highest leverage, and sequence them honestly given low adoption (= rewrite permission, no migration tax).

**Not new vision. Compressed direction.**

## Where the docs say we want to be (anchored)

Per `05-DESIGN-NORTH-STAR.md §4` and `06-MISSION-STATEMENTS.md`:

1. **10 capability concerns** (`Sense → Attend → Comprehend → Recall → Reason → Decide → Act → Verify → Reflect → Learn`) implemented as services with: one owner, typed contract, observable events, replaceable strategy, isolated tests, **and a live emit/consumer in the same commit as declaration**.
2. **Single Arbitrator per iter** — five signal sources → one Verdict (`continue | exit-success | exit-failure | escalate`).
3. **Pure sensors + Loop Controller as sole state mutator** (≤10 mutation sites total).
4. **Strategies as declarative compositions of capabilities** (`Pillar 3 mission`: "New algorithmic shapes (BFS, critique, plan-revision) are first-class primitives; new strategies are array literals. ≤200 LOC per strategy including tests").
5. **Composition surface > config menu** (`Anti-mission #3`: 24 named override methods IS the failure mode).
6. **Honest fail** (`Anti-mission #4`: `status=failed → output=null`, never papered over).
7. **Frontier and local equally first-class** (`Anti-mission #2`: tier-gated features ship with explicit `requiresTier` flag).
8. **No scaffold without callers** (`G-9`, `Anti-mission #6` — the single highest-leverage lesson from sweep-2026-05-23).

**The vision is not vague. It's specific and falsifiable.**

## Where the code currently is (objective delta)

| Aspect | Target (per docs) | Current | Delta |
|---|---|---|---|
| Capability dirs | 10 (per North Star §4.3) | 8 present, `recall/` + `learn/` missing | -2 |
| Strategy LOC ceiling | ≤200 LOC each | reflexion 774, plan-execute 1548, ToT 727 | **~7× over budget** |
| Strategy composition shape | "array literals" | hand-written Effect.gen programs | not composable |
| Builder methods | "one composition surface" | **75 `withX()` methods** | anti-mission #3 violation |
| Mutation sites (kernel) | ≤10 | not measured | unknown (likely >>10) |
| Capability emit at boundary | every capability emits | runner.ts owns emit; strategies bypass kernel instrumentation | G-10 open |
| Scaffold without callers | zero | 4 dead Compose tags + 8 dead ControllerDecision variants + ~9 dead calibration fields + 1 silent skill persistence path (G-9) — Phase 0 fixed 5 of these in May 2026 sweep | partial |
| Drift contracts CI-enforced | per-capability | 4 (just shipped in PR #137) — covers finalize/critique/runPass/emitPhaseEnd | scaling |

**Gap is real and asymmetric.** Some pillars 90% there (Decide, Verify, single termination). Others not started (capability composition, builder reduction).

## The leverage map — which moves unlock multiple pillars at once

Not all architectural moves are equal. Ordered by leverage (pillar count × delta size):

### LEVERAGE-1: Combinator layer above primitives = unlocks Pillars 3 + 4 + 5 + 6

**The single highest-leverage move available right now.**

`iterateUntil<S>`, `branchAndPick<C>`, `routedDispatch` (proposed in `2026-05-25-framework-composition-vision`) directly satisfy Pillar 3's "strategies as array literals, ≤200 LOC" mission. Each combinator:
- Encapsulates a loop-control pattern (reflexion's improve loop, plan-execute's reflect loop, code-action's verify loop)
- Owns the termination decision in a typed way (Pillar 5: Arbitrator-shaped)
- Inherits capability instrumentation automatically (Pillar 2 + 4: no per-strategy re-wiring)
- Provides one mental model for new strategy authors (Pillar 3 DX + Pillar 6 efficiency through reuse)

**Why now:** PR #137 just shipped 4 primitives. The primitives are the ingredients; combinators are the recipes. Reflexion's loop = 80 LOC of hand-written bookkeeping today; under `iterateUntil` = 15 LOC.

**Estimated total reduction:** reflexion 774 → ~150 LOC (Pillar 3 target met). plan-execute and code-action follow.

### LEVERAGE-2: Capability emit-at-boundary (`G-10` resolution) = unlocks Pillars 2 + 4 + 5

Currently `runner.ts` owns emit; strategy outer-loops bypass kernel instrumentation. Target: every capability dir owns its own `emit-X` event at the capability boundary. Strategies become observable identically regardless of control-flow shape.

**Why now:** Combinator layer (LEVERAGE-1) forces this — when `iterateUntil` calls capability primitives, the instrumentation MUST live at the primitive boundary. Otherwise different strategies emit differently. The two moves are coupled.

### LEVERAGE-3: Generalize the drift-contract pattern (`G-9` permanent fix) = unlocks Pillars 1 + 2 + 5 + Reliability across the board

PR #137 introduced 4 grep-based drift contracts (one per primitive). They make duplication a build break. **The pattern should become a framework convention**, not a per-primitive opt-in.

Concrete:
- **`tools/lint-drift.ts` — declarative drift-contract registry** at the package root. Every new primitive registers its signature. CI runs ALL contracts on every PR.
- **Capability decl convention**: every capability dir has a `contract.ts` declaring what shape MUST flow through it (e.g., `verify/contract.ts` declares "all severity-aware verifier calls route through `runVerifier`").
- **"Scaffold without callers" lint rule**: declared TagMap entries / decision variants / calibration fields MUST appear in a live emit site within the same PR. Lint failure if absent.

**Why now:** the drift-contract pattern is the proven antibody against the very anti-pattern (G-9) the docs call the highest-leverage lesson. Don't ship 4 contracts and stop — make it the architectural default.

### LEVERAGE-4: Builder ≤20 methods + composition primitive = unlocks Pillar 3 + Anti-mission #3 + DX compounding

Current 75 methods is the documented failure mode. Target: builder becomes a thin convenience layer over `composeAgent(...capabilities)` (per vision doc). Power users compose directly; beginners use builder.

**Why now:** Low adoption means breaking changes are cheap. Every example in docs uses builder — but only 10 stars means example migration is bounded. A v0.12 breaking change is genuinely viable.

**Concrete first move:** define `composeAgent(...capabilities)` + 9 `capabilities.X()` constructors (provider, tool, strategy, killswitch, hook, memory, guardrail, observability, persona). Ship as parallel API. Builder methods internally route to `composeAgent`. Documentation moves to composition-first; builder relegated to "convenience" section.

### LEVERAGE-5: Empirical-evidence loop = unlocks Pillar 6 + Reliability long-term

Every primitive / combinator / capability needs the 6-gate evidence template from PR #137 (≥2 consumers same PR, det tests, drift contract, live LLM probe, live tool probe, LOC + test delta logged). **Standardize this as a PR template.**

**Why now:** this protects everything above from drift back to "scaffold without callers" or "config menu" failure modes. The vision is operational only if the evidence rhythm continues.

## The minimum set (what to actually build)

Synthesizing the leverage map into the smallest set of changes that close the gap:

| # | Move | Pillars | Effort | Pre-req |
|---|---|---|---|---|
| **1** | Ship combinator layer (`iterateUntil` against reflexion alone first) | 3, 4, 5, 6 | 2 weeks | PR #137 (done) |
| **2** | Resolve G-10: capability emit-at-boundary (coupled with combinator) | 2, 4, 5 | 1 week | #1 partial |
| **3** | Lift drift-contract pattern to framework default (`tools/lint-drift.ts` + `scaffold-without-callers` lint) | 1, 2, 5, Reliability | 1 week | parallel-eligible |
| **4** | Define `composeAgent(...capabilities)` as parallel API + map 75 builder methods to internal compose calls | 1, 3, DX | 3-4 weeks | #1 + #2 land first |
| **5** | Create missing capability dirs (`recall/`, `learn/`) per North Star §4.3 | 1, 2 | days | none |
| **6** | PR template enforces 6-gate evidence rhythm | All — compounding | 1 day | none |

**Total: ~6-8 weeks of focused architectural work. Outcome: framework matches its own documented North Star.**

## What we explicitly STOP doing (the kill list)

Just as important as what to build. Low adoption = permission to delete.

1. **Stop adding builder methods.** Today's 75 is the ceiling. New capabilities ship via `composeAgent`. Builder grows ONLY via internal routing.
2. **Stop documenting builder examples first.** Docs lead with composition; builder is "if you prefer fluent" addendum.
3. **Stop shipping new tags/variants/fields without live consumers.** Lint-enforced (LEVERAGE-3). Zero exceptions.
4. **Stop hand-writing strategy control-flow loops.** New strategies use combinators. Old strategies migrate opportunistically when adjacent code touches them.
5. **Stop introducing test-only env-vars** (`REACTIVE_AGENTS_NOOP_VERIFIER` smell). Tests use Layer override at boundary.
6. **Stop debating package count.** 35 → ~22 per North Star §5.4 is a side-quest. Internal decomposition matters; publish boundaries don't.
7. **Stop writing new vision docs.** Direction is set. Execute.

## What we accelerate

Low adoption = breaking changes are cheap. Things normally deferred become viable:

1. **Major API rename** if it materially improves DX (e.g., `withReactiveIntelligence` declared twice = rename to one canonical surface, drop the dupe).
2. **Package consolidation** per North Star §5.4 (5 mergers identified) — do it once during v0.12, document migration in CHANGELOG.
3. **Builder method deprecation** — 75 → 20 by end of v0.13. Pre-PMF window.
4. **`ReactiveAgent` runtime surface** — rename / merge facade packages opportunistically.

## What we never do (boundaries)

Per anti-missions:

- **Never magic black box.** Every decision auditable.
- **Never frontier-only.** Local-tier (cogito:14b, qwen3:14b) stays first-class.
- **Never config menu.** Composition surface, not method bloat.
- **Never paper over failure.** Honest-fail invariant non-negotiable.
- **Never instrumentation-late.** Trace + emit ships in same commit.
- **Never scaffold without callers.** Lint-enforced.
- **Never own the application loop.** RunHandle exposes control.
- **Never unitary intelligence.** Composition is the substrate.

## The compounding effect — why this sequence

The 6 moves above are not independent. They COMPOUND:

```
Combinator layer (#1)
  → forces emit-at-boundary (#2)
    → which makes drift-contract pattern (#3) automatic for capabilities
      → which makes composeAgent (#4) trustable for new capability kinds
        → which makes new capability dirs (#5) follow the same template
          → all reinforced by PR rhythm (#6)
```

Each move makes the next cheaper. **This is the architectural compounding effect** the user asked for. Bottom-up alone gives diminishing returns; this sequence gives compounding ones.

## What this unlocks (the industry gap closes)

If executed, the framework offers what the industry **doesn't have today**:

1. **Auditable agent decisions** — every Verdict traces to a source signal. LangChain, Autogen, Swarm, Mastra: black-box termination.
2. **Local-tier-first reliability** — cogito:14b and qwen3:14b are not "fallback" tiers. They're first-class. No other major framework treats them this way.
3. **Composable reasoning algorithms** — "BFS + critique + plan-revision" as array literal. Today's frameworks: monolithic strategy classes.
4. **Honest-fail invariant** — `status=failed → output=null` always. Industry default: synthesized fallback text masquerading as success.
5. **Drift-contract architecture** — duplication is a CI fail, not a code-review hope. No other framework has this.
6. **Replayable agent runs** — every step a typed value, capability composition is serializable. Snapshot-replay falls out free.

**This is the "what the industry desperately needs" — not new features, but architectural reliability properties no one else ships.** With 1.1k NPM downloads and a year of focused execution, this becomes a differentiator that compounds.

## Honest risk register

1. **Scope creep on combinators.** `iterateUntil` might want to grow into a state machine. Resist. Ship narrow first.
2. **Builder ≤20 methods deprecation hurts the 10 starred users.** Plan: ship `composeAgent` as parallel API for v0.12; builder methods still work + emit deprecation warning; full removal v1.0+.
3. **Capability emit-at-boundary refactor touches every strategy.** High-touch, low-novelty. Plan: one strategy at a time, gated by combinator migration.
4. **Drift-contract lint becomes false-positive heavy.** Plan: opt-out comment per site (proven in PR #137).
5. **Evidence-rhythm tax slows feature work.** True. Accept. The rhythm IS the value — see G-9 anti-pattern cost.
6. **Combinator design is wrong on first attempt.** Plan: prototype against reflexion ALONE first. If the shape works, migrate plan-execute + code-action. If not, revert and iterate before bundling more.

## Decision sequence (next 90 days)

**Week 1-2:** Combinator prototype (`iterateUntil` against reflexion). Land OR revert with learnings.

**Week 3:** Drift-contract framework convention (`tools/lint-drift.ts`). Decoupled — ships parallel.

**Week 3-4:** If combinator works → migrate plan-execute (#2 consumer). If it doesn't → re-evaluate.

**Week 5-6:** Capability emit-at-boundary on the strategies migrated to combinators. G-10 resolution starts.

**Week 7-10:** `composeAgent(...capabilities)` as parallel API. Builder methods route internally. Docs updated.

**Week 11-12:** Missing capability dirs (`recall/`, `learn/`). PR template formalized.

**Week 13+:** Opportunistic migration. Continued evidence rhythm. Re-evaluate direction.

## How to use this memo

- **For prioritization:** when picking next PR, ask "which leverage point does this hit?"
- **For PR review:** does the PR honor the 6-gate evidence rhythm? Does it move a pillar metric? If neither, ask why.
- **For roadmap planning:** the 6-move minimum set is the v0.12 + v0.13 backbone. Other work is parallel only when it doesn't compete for the same architectural review attention.
- **For external positioning:** the differentiator pitches in §"What this unlocks" are messaging foundations once executed.

## Provenance

- Drafted: 2026-05-25, after primitive-extraction PR (#137) shipped + vision doc landed
- Anchors: 05-DESIGN-NORTH-STAR v5.0, 06-MISSION-STATEMENTS, 07-OPTIMAL-EXECUTION-ALGORITHM
- Empirical basis: primitive-extraction PR proved the bottom-up methodology + drift-contract pattern at 4-consumer scale
- Trigger: user request 2026-05-25 — "plan and execute on the absolute ideal, robust architecture that's going to enable us to achieve what the industry doesn't offer yet but desperately needs"
- Cadence: re-evaluate every 4 weeks based on which leverage point landed vs deferred

## What this memo is NOT

- NOT a build plan. Each move needs its own design spec + evidence gate.
- NOT a vision. Direction is set by `00-VISION.md` and `05-DESIGN-NORTH-STAR.md`. This is execution priority.
- NOT a complete enumeration. Architectural details (e.g., how `iterateUntil`'s state generic threads through Effect-TS) live in per-move design specs.
- NOT immutable. Re-evaluate every 4 weeks. Update with empirical learnings.
