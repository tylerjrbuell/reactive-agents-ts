---
tags: [architecture, drift, harness, north-star]
date: 2026-05-23
basis: harness sweep 2026-05-23 + advisor reframe + 4 analysis moves
supersedes-frame: "harness needs improvement"
actual-frame: "60% of North Star v5.0 shipped, 40% drifted into parallel substrates"
---

# Harness Architecture Drift Analysis — 2026-05-23

## Reframe

The North Star v5.0 design (`wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`) **already describes the next-level harness**. The 8 sweep findings (`sweep-2026-05-23-qwen3-14b.md`) are not 8 separate issues — they collapse to **one structural drift**: capabilities are kernel-owned but loop control is strategy-owned, so 4 of 5 strategies bypass the kernel and re-implement loop semantics from scratch.

The job is not invention. It is detection of which design intents shipped, which drifted, and the migration plan to reconverge.

---

## The Root Drift — Strategy bypasses Loop Controller

**North Star §4.2:** *"Loop Controller is the only state mutator. Owns the iteration cycle. Sequence is fixed: sense → integrate → arbitrate → act → learn → loop."*

**Reality:**

| Strategy | File | LOC | Consumes runner.ts? |
|---|---|---|---|
| reactive | `strategies/reactive.ts` | 302 | ✅ yes (via `runKernel`) |
| direct | `strategies/direct.ts` | 217 | partial |
| plan-execute-reflect | `strategies/plan-execute.ts` | **1554** | ❌ reimplements loop |
| reflexion | `strategies/reflexion.ts` | 860 | ❌ reimplements loop |
| tree-of-thought | `strategies/tree-of-thought.ts` | 623 | ❌ reimplements loop |
| code-action | `strategies/code-action.ts` | 242 | ❌ own worker-thread loop |
| adaptive | `strategies/adaptive.ts` | 383 | dispatches to one of above |

**Total reimplementation surface: 3,279 LOC outside the kernel doing capability work the kernel already owns.**

Every sweep finding collapses to this:

- F1 (no plan-execute trace) — diagnostic emit is in `runner.ts`, plan-execute never calls it
- F3 (RI dispatcher silent) — RI fires only on kernel iteration events; plan-execute emits none
- F4 (verifier shallow pass) — verifier only at `runner.ts:1606`; plan-execute uses its own `noopVerifier`
- F7 (no llm-exchange) — emit point doesn't exist anywhere yet, but strategies wouldn't trigger it if it did
- F8 (slow think no telemetry) — no Learn step + no llm-exchange + plan-execute's reflect phase is opaque

---

## Three Unflagged Conceptual Conflicts

### Conflict 1 — Five parallel incident systems, no Arbitrator

**North Star §4.2:** *"Arbitrator is a pure function (integrated signals, state) → Verdict. Returns exactly ONE of: continue | exit-success | exit-failure | escalate. The only place termination is decided."*

**Reality — five systems decide intervention/termination independently:**

| System | Trigger signal | Verdict shape | What it shortcircuits | Owner file |
|---|---|---|---|---|
| RI dispatcher | composite entropy + decision suggestions | `InterventionDecision` or skip | loop continuation | `reactive-intelligence/controller/dispatcher.ts` |
| Killswitches (Compose) | phase hook callback | `{abort: 'stop' \| 'terminate', reason}` | loop entirely | `compose/src/killswitches/*` |
| Verifier | terminal output gate | `{verified: bool, checks[]}` | terminal acceptance | `kernel/capabilities/verify/verifier.ts` |
| Healing pipeline | tool error structure | recovery action or rethrow | tool call result | `tools/src/skills/healing-pipeline.ts` |
| Strategy switching | loop-detector + entropy | new strategy + re-spawn | current strategy | `kernel/capabilities/reflect/strategy-evaluator.ts` |

None of these read the others. Implicit reconciliation by execution order. F3 (entropy threshold mutes RI) is a symptom — entropy is one signal among many, not the gate for one of five parallel verdict-emitters.

**Empirical evidence of drift:** `rtk grep 'state\.status\s*=\|terminatedBy' packages/reasoning/src packages/runtime/src` → **170 matches across 14+ files**. North Star says "9 termination paths consolidated → 1 (`terminate.ts`)" — that's the helper. The decision sites multiplied back.

### Conflict 2 — `learn/` capability does not exist

**North Star §4.3:** *"LearningPipeline at `kernel/capabilities/learn/`."*

**Reality:** `ls packages/reasoning/src/kernel/capabilities/` returns `act/ attend/ comprehend/ decide/ reason/ reflect/ sense/ verify/`. **Eight directories, not ten.** `learn/` and `recall/` (memory integration) are missing.

The "Compounding Intelligence" trait (M6 skill persistence, M7 calibration, M10 memory) is scattered across separate packages with no loop integration point. Every iter ends without a Learn step. The loop literally has no consolidation point — explains why M6/M7/M10 are all "🔄 IMPROVE" in Phase 1 verdicts despite individually working.

### Conflict 3 — Compose API vs RI dispatcher overlap is undeclared

**Compose API design spec** (`wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md`, 46KB, dated May 6) mentions RI **exactly twice** — only as a *source* of `decision.strategy-switch` events for compose tap.

No subsumption plan. No migration plan. Two intervention substrates shipped:
- **Compose**: TagMap hooks + pure transforms (12 phase points, 7 chokepoint tags)
- **RI**: typed handlers + entropy + 4 suppression gates (4 decision types)

They overlap in concept (observe runtime → fire intervention) but differ in everything else (typing, gating, lifecycle, naming). Either Compose subsumes RI (RI becomes default Compose subscriptions) or this is permanent dual-substrate.

**This is the highest-leverage architectural decision pending.** Until resolved, every new harness signal must decide which substrate to publish to.

---

## What Next-Level Harness Must Satisfy (Constraints)

Lifted from advisor synthesis + North Star v5.0:

1. **Single Arbitrator.** All incident signals (entropy, loop-detect, tool-failure, verifier-reject, killswitch-trigger, healing) feed ONE function returning one Verdict per iter. The 5-system parallelism becomes 5 inputs to 1 decider.

2. **Universal capabilities.** Every strategy is a declarative composition over the same 10 capabilities. New strategy = new phase array, not new file with reimplemented loop. plan-execute / reflexion / ToT become **phase compositions**, not parallel kernels.

3. **Capability-scoped observability.** `emitKernelStateSnapshot`, `emitVerifierVerdict`, `emitLLMExchange` fire from capability invocations (`act/`, `verify/`, `reason/`), not from strategy code. Strategy can't bypass instrumentation by bypassing the kernel.

4. **`learn/` as first-class capability.** Every iter ends with a Learn step writing to calibration / memory / skill. Compounding intelligence has an owner.

5. **One intervention substrate.** Compose API hooks are the canonical gate. RI becomes default Compose subscriptions. Verifier becomes `after('act')` phase hook. Healing becomes `onError('act')`. Killswitches stay where they are (they're already Compose). Strategy-switch becomes `nudge.strategy-evaluated` hook.

6. **Loop Controller owns state mutation.** `state.status = …` outside `terminate.ts` or the canonical state transition helpers is a lint failure. 170 sites become ≤10.

7. **Each capability one owner.** Today `reflect/` has loop-detector + reactive-observer + strategy-evaluator — three sub-owners. Either integrate via single ReflectionEngine entry point or split into separate capabilities. Same audit for `act/` (6 files), `verify/` (4 files).

---

## Morph Direction — Migration Path

This is not greenfield. The migration target is North Star v5.0 §4 already specified.

### Phase 1 — Convergence Foundations (high leverage, no behavior change)

**1.1** Wire `emitKernelStateSnapshot` + `emitVerifierVerdict` + `emitLLMExchange` from **capabilities**, not from runner.ts. Strategies inherit instrumentation for free. Closes F1, F4, F7, F8 transitively.

**1.2** Move `state.status` mutation behind a `transitionState()` helper (already exists in `kernel-state.ts`). Add a lint rule banning direct `state.status =` assignment outside that helper. Closes the 170 → ≤10 termination-site drift.

**1.3** Decide Compose-vs-RI policy explicitly. Three viable paths:
  - **(a) Subsume RI under Compose** — RI handlers become default Compose subscriptions; RI package becomes a preset bundle. (high leverage, biggest cleanup)
  - **(b) Keep dual** — document the boundary and write a migration test ensuring no overlap leaks. (low leverage but ships fast)
  - **(c) Subsume Compose under RI** — unlikely (Compose is the typed surface), but a viable conservative option.

  This decision blocks coherent harness design until made. Single sentence answer required before any further intervention-system work.

### Phase 2 — Strategy Re-platforming

**2.1** Refactor each non-runner strategy to consume the kernel as a **phase composition**:
  ```ts
  // hypothetical post-morph
  export const planExecuteReflect = phases([
    plan,        // emits prompt.plan, returns Plan
    execute,     // runs runKernel(reactive) per step
    reflect,     // emits prompt.reflect, evaluates results
    terminate,   // Arbitrator decides continue|done|fail
  ])
  ```
  Each phase is a thin wrapper over capabilities. The strategy file shrinks from 1554 → ~200 LOC. Diagnostics, RI, verifier, healing flow through transparently because the kernel still owns the iter.

**2.2** Open `learn/` capability with `LearningPipeline` that consolidates per-iter writes to calibration / skill / memory. M6/M7/M10 plug into a single owner instead of three orphaned consumers.

### Phase 3 — Arbitrator Consolidation

**3.1** Build `Arbitrator(signals, state) → Verdict` as a pure function in `decide/`. Inputs: RI decisions, killswitch triggers, verifier verdicts, healing outcomes, loop-detect signals, oracle nudge state. Output: one of `continue | exit-success | exit-failure | escalate`. The five parallel systems become five signal **sources**.

**3.2** Loop Controller consults Arbitrator once per iter. No other site decides termination. F3 is auto-resolved (entropy stops being THE gate — it becomes one of many inputs).

---

## What This Reframes

| Old framing | Sharper framing |
|---|---|
| "Harness needs improvement." | "Harness has 60% of North Star shipped + 40% parallel-substrate drift." |
| "Fix F4 verifier check." | "F4 exists because verifier only fires on reactive kernel. Fix is capability-scoped instrumentation, not a new check." |
| "Add llm-exchange events." | "Emit from `reason/think.ts` capability. Strategies inherit." |
| "RI dispatcher dead weight on local tier." | "RI's signal value is real; its substrate is duplicated by Compose. Decide subsumption direction first." |
| "Compose API is the v0.11 differentiator." | "Compose API is the **convergence target** — every shipped harness mechanism morphs into a Compose subscription." |
| "Phase B is done." | "Phase B (Compose surface) is done. Phase B' (migrate existing systems onto Compose) hasn't started." |

---

## Top-3 Architectural Calls Required From Owner

1. **Compose-vs-RI policy** — subsume, dual, or invert? Blocks all further intervention-system work.
2. **Strategy re-platforming OK?** — accept that plan-execute / reflexion / ToT shrink to phase compositions, even if migration takes a phase or two. The alternative is permanent instrumentation duplication.
3. **`learn/` ownership** — does it live in `kernel/capabilities/learn/` (new) or stay scattered across memory + skill + calibration packages? Drives whether M6/M7/M10 ever truly compound.

---

## Recommended Next Move

Not implementation. **Write the migration spec** as `wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md` answering the three calls above. From there, the implementation breakdown is mechanical:

- Decisions 1–3 → Phase 1 work items (3 commits, no behavior change)
- Strategy re-platform → Phase 2 (one strategy at a time, behavior-preserving refactors)
- Arbitrator consolidation → Phase 3 (single high-stakes commit; gated by Phase 1+2)

The 8 sweep findings will close as side effects of Phase 1–2; treating them as spot fixes is the wrong altitude.

---

## Companion Reading

- `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` §3 (10 capabilities), §4 (cognitive architecture), §9 (Pruning Principle)
- `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md` — Compose surface design
- `wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md` — the empirical sweep that surfaced the drift
- `wiki/Architecture/Specs/02-FAILURE-MODES.md` — FM-C1 (unmitigated), FM-D2 (open) — both downstream of root drift
