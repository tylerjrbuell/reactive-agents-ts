---
tags: [evidence, capability-mapping, q2a]
date: 2026-05-23
campaign-step: 1
answers: Q2a (% of strategy LOC capability-mappable)
companion: architecture-drift-analysis-2026-05-23.md
---

# Capability Mapping Audit — Strategy Internal Structure

## Headline result

The initial drift framing ("4 of 5 strategies bypass the kernel") was **incomplete**. Empirically:

**5 of 7 strategies use `runKernel(reactKernel, ...)` for tool-bearing execution.** What they reimplement is OUTER LOOP CONTROL — algorithmic shapes the per-iter kernel cannot natively express.

```
strategy            uses runKernel?    outer-loop algorithm
─────────────────────────────────────────────────────────────────────────
reactive            ✅ yes (1 call)    per-iter ReAct
direct              ✅ yes (1 call)    capped ReAct (max 1 iter)
reflexion           ✅ yes (2 calls)   initial→critique→improve (critique = pure LLM, no kernel)
tree-of-thought     ✅ yes (1 call)    BFS path exploration → best path → kernel execute
plan-execute        ⚠️  mixed          plan → wave-execute (tool calls bypass kernel) → reflect
code-action         ❌ no              own worker-thread sandbox (genuine substrate divergence)
adaptive            n/a (router)       picks one of above
```

## Per-strategy capability mapping

### reactive (`strategies/reactive.ts`, 302 LOC)

Thin wrapper. Capability mapping is **100% kernel-owned**.

### direct (`strategies/direct.ts`, 217 LOC)

Thin wrapper, max=1. Capability mapping is **100% kernel-owned** with a strategy-specific cap.

### reflexion (`strategies/reflexion.ts`, 860 LOC)

| Block | LOC | Maps to |
|---|---|---|
| Setup/services | 100 | boilerplate |
| L118 Initial generation via runKernel(reactKernel) | 80 | **REASON+ACT via kernel** ✅ |
| L197 Reflect → Improve outer loop | 50 | strategy-specific outer control |
| L211 Self-critique (pure LLM, no tools) | 80 | **REASON via direct LLM call** (no tools by design — design intent) |
| L292 Critique-convergence early stop | 70 | **REFLECT** (strategy-specific) |
| L364 Refinement via runKernel(reactKernel) | 120 | **REASON+ACT via kernel** ✅ |
| L487-end Helpers (parse critique, build prompts) | 360 | utilities |

**Verdict:** Kernel ownership ~25% (generation + refinement). Outer critique loop is **genuine algorithmic divergence** — critique-as-pure-LLM with convergence detection is the reflexion algorithm; not a kernel pattern. Outer loop bypass is **necessary, not accidental**.

### tree-of-thought (`strategies/tree-of-thought.ts`, 623 LOC)

| Block | LOC | Maps to |
|---|---|---|
| Tier-adaptive depth config | 50 | strategy-specific |
| L153 ToT outer-loop early-stop wiring | 40 | **REFLECT** (already partially RI-integrated) |
| L166 BFS expansion (generate candidate thoughts) | 130 | **REASON** (strategy-specific algorithm) |
| L301 Score stagnation check | 50 | **REFLECT** (strategy-specific) |
| L345 Dispatcher early-stop check | 40 | **REFLECT** (RI integration adapter) |
| L437 Select best path | 30 | **DECIDE** (strategy-specific) |
| L478 Execute best path via runKernel(reactKernel) | 50 | **REASON+ACT via kernel** ✅ |
| L538-end Helpers | 230 | utilities |

**Verdict:** Kernel ownership ~10% (best-path execution). BFS exploration is **genuine algorithmic divergence**. ToT's value IS the tree-search; collapsing it into per-iter kernel destroys the strategy.

### plan-execute (`strategies/plan-execute.ts`, 1554 LOC)

| Block | LOC | Maps to |
|---|---|---|
| L88-150 Setup/services | 65 | boilerplate |
| L154 PLAN via extractStructuredOutput | 55 | **REASON** (structured output is an act-shape) |
| L211 Rationale enforcement retry | 42 | **VERIFY + REASON-retry** |
| L255 Required tools synthesis injection | 52 | **ACT preparation** (or guard?) — strategy-specific |
| L309 Quantity enforcement injection | 27 | same pattern as above |
| L338 PlanStore persistence | 6 | **LEARN** (cross-session, M6/M10 territory) |
| L355 Main refinement loop | 250 | strategy-specific outer control |
| L390 EXECUTE wave-scheduling | 180 | strategy-specific (dependency DAG topo-sort) |
| L601 REFLECT block (LLM eval) | 60 | **REFLECT via LLM** |
| L662 PER entropy scoring + synthetic kernel state | 100 | **REFLECT** — but with **substrate-mismatch adapter** |
| **L1063 executeStep — tool_call branch BYPASSES kernel** | 100 | **ACT direct** ⚠️ (drift) |
| L1063 executeStep — analysis branch via runKernel | 150 | **REASON+ACT via kernel** ✅ |
| L1317 patchPlan | 60 | **REASON** (strategy-specific revision) |
| L1366 augmentPlan | 60 | **REASON** (strategy-specific revision) |
| L1432-end Utility helpers | 100 | utilities |

**Critical finding at L1077-1117:** plan-execute's `executeStep` calls `toolService.execute()` DIRECTLY for `step.type === "tool_call"` steps, bypassing kernel's act phase. Explicit comment at L1104-1106: *"plan-execute owns tool dispatch directly (no kernel act-phase), so without this hand-off the rationale never reaches the rationaleLog subscriber."*

This is the **drift root** for F1 (no plan-execute kernel-state-snapshots): tool dispatch bypasses kernel act, where `emitKernelStateSnapshot` fires. The synthetic kernel-state at L667 is the workaround.

**Verdict:** ~25% capability-mappable; ~30% strategy-specific algorithm (wave scheduling, plan revision); ~10% drift (direct tool dispatch could route through kernel); ~35% boilerplate + utilities.

### code-action (`strategies/code-action.ts`, 242 LOC)

Worker-thread sandbox. **Genuine substrate divergence** — runs TypeScript IIFE, not LLM iter loop. ~0% capability-mappable in the current kernel substrate sense. North Star pre-acknowledges (`Phase D — Code-as-Action Strategy`).

## Q2a Answer

**% of strategy LOC capability-mappable (kernel-ownable):**

| Strategy | % kernel-mapped | % strategy-algorithm | % drift | % boilerplate |
|---|---|---|---|---|
| reactive | 100% | 0% | 0% | 0% |
| direct | 100% | 0% | 0% | 0% |
| reflexion | ~25% | ~25% (critique loop) | 0% | ~50% (utilities) |
| tree-of-thought | ~10% | ~35% (BFS + scoring + selection) | 0% | ~55% (utilities) |
| plan-execute | ~25% | ~30% (wave-schedule, plan revision, RI adapter) | ~10% (direct tool dispatch) | ~35% (utilities) |
| code-action | ~0% | ~80% (sandbox lifecycle) | 0% | ~20% |

**Aggregate non-trivial-strategy capability-mappable: <30%.**

The drift analysis's threshold "≥70% mappable → re-platform" is **not met**. ≥70% mappable would mean strategies are accidental duplications. Empirically they encode **genuine algorithmic divergence** (critique loop, BFS, plan-revision) that the per-iter kernel cannot natively express.

## What this changes about the morph direction

The drift analysis's Call 2 ("strategy re-platform") needs sharper scope:

**Wrong target:** collapse strategies into the kernel.
**Right target:** capability-scoped instrumentation that survives wherever strategies put their outer loop.

Concretely:

1. **`emitKernelStateSnapshot` should fire from strategy outer-loop iterations**, not only from `runner.ts` inner iterations. Strategies already emit `LogEvent`s for outer phases (`plan-execute:plan`, `tree-of-thought:explore`, `reflexion:critique`); they need to also emit `KernelStateSnapshotEmitted` for diagnostic uniformity. The emit helper exists; strategies just don't call it.

2. **Plan-execute's direct tool dispatch (L1077-1117) should route through a tool-execution capability** — the *one* genuine kernel-bypass. Either (a) call kernel's act phase as a sub-call, or (b) extract a shared `executeToolCall()` capability that both kernel act and plan-execute use, and make the diagnostic emit live there.

3. **Critique loop, BFS, plan-revision STAY in strategies.** They're algorithmic, not loop-control drift.

4. **The synthetic kernel-state adapter (plan-execute L667)** is a smell that the kernel-state contract is too kernel-shaped. Either generalize the contract or accept the adapter as a permanent translation layer between substrates.

**Revised Call 2:** "Capability-scoped instrumentation + tool-execution capability extraction." Scope: ~200 LOC of additions across strategies + 1 helper extraction. Not a 3,279 LOC collapse.

## Effect on Calls 1 and 3

Q2a doesn't directly modify C1 or C3, but it does sharpen them:

- **Call 1 (Compose-vs-RI):** plan-execute's L662 PER entropy + synthetic-state adapter is concrete evidence that RI has a contract too tight to share between kernel and strategy substrates. Compose's tag-based pattern matching is substrate-agnostic. **Empirical signal weakly favors Compose subsumption** even before Q1a/b runs.

- **Call 3 (`learn/`):** plan-execute already writes to `PlanStoreService` (L338-343) — a learn-shaped op exists, just in a service-not-capability shape. Reflexion has cross-iter memory in critique history. ToT scores paths. Each strategy has its own learn-flavored side-channel. A unified `learn/` capability would consolidate these. **Empirical signal supports opening `learn/`** because scatter is real.

## Step 1 done. Step 2 next (RI vs Compose event coverage diff).
