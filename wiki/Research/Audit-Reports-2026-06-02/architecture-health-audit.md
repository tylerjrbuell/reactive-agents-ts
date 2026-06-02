---
title: Architecture Health Audit — current state vs goals/vision/north-star (2026-06-02)
date: 2026-06-02
scope: full repo, architecture-level (not unit/code-level)
method: inline architecture-audit (3 lenses run by main thread, code-verified — no subagent fan-out)
branch: refactor/canonical-sprint2-2026-06-02
anchors:
  - wiki/Architecture/Specs/00-VISION.md (8 pillars)
  - wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md (structural target)
  - wiki/Architecture/Design-Specs/2026-06-02-canonical-contracts-and-invariants.md (the guarantee layer, design-spec proposed TODAY)
  - wiki/Architecture/Design-Specs/2026-05-30-canonical-agentic-convergence.md (post-condition spine + capability axis)
---

# Architecture Health Audit — 2026-06-02

> **One-line verdict.** Foundation is **strong and canonical** (clean layers, acyclic kernel, single arbitrator, canonical data-flow); the typed-guarantee layer is **mid-migration and on-plan** (don't cry scaffold); there is **one earned enforcement gap** (I4 single-resolver, with a real bug to prove it); and the **genuine gap between current state and the vision is the parked capability axis** — Pillar 8 (compounding intelligence) is unstarted.

---

## 0. How to read this

The user asked: health of the design/architecture **as it relates to our goals, vision, and north-star**. So this audit is organized by *distance from the vision*, not by cast-count hygiene. Structural hygiene is near-done (see §4); the interesting findings are where the code is furthest from the 8 pillars.

A recurring meta-finding: **every status document in this repo lags the code by ~1 sprint.** The architecture-audit skill's own pre-loaded debt table is stale (references `strategies/kernel/` moved to `kernel/`, `meta: as any` resolved, `context-engine.ts` 690→250 LOC). The canonical plan frontmatter was stale (fixed this session). Trust the tree, not the paperwork.

---

## 1. What is genuinely strong (verified)

| Pillar | Evidence (code-verified 2026-06-02) |
|---|---|
| **Layering** | `packages/reasoning` has **0 upward imports** of runtime/facade. Dependency rule holds. |
| **Kernel structure (Scalability)** | 10 capability dirs present; mesh is a **DAG — 0 cycles** (16 acyclic cross-cap edges; the plan's "7 cycles" is stale). `tool-parsing`→`utils/`, `tool-gating`→`decide/` already relocated. |
| **State discipline (Pillar 4)** | **0 raw `state.status =`** in the kernel; 106 `transitionState()` callsites. The ≤10-mutation invariant holds. |
| **Single Arbitrator (Reliability)** | `decide/arbitrator.ts` is the canonical single-owner termination decision (9 evaluators + Verdict-Override). No competing termination path. |
| **Canonical data-flow** | `project(log, capability, store)` is the **sole live kernel context path** (`think.ts:352`); event log + content-addressed ResultStore shipped under `assembly/`. |
| **Runtime composition** | `runtime.ts` on `Layer.mergeAll` (3 `ComposableLayer` casts, not the plan's 44). |

This is a healthy core. The framework is NOT in architectural trouble — it is in the *last mile* of a well-sequenced migration.

---

## 2. The real gap vs the VISION — Pillar 8 (Compounding Intelligence) is unstarted

**This is the headline finding.** The cutover doc (`2026-05-31-cutover-critical-path-and-efficiency`) named it against itself: *"nearly all work was on the cleanliness axis while the capability axis sat parked … measuring clean, assuming performant."*

Verified: `grep recit|progressLedger|experienceReuse|reciteProgress packages/reasoning/src` → **0 matches.**

- **Post-condition spine SHIPPED** (#7 `bc5737a1` / A4 unconditional) — the state-grounded *done*-authority. ✅
- **Recitation** (progress ledger recited into recency) — **NOT wired.**
- **Experience-reuse** (cross-run compounding) — **NOT wired.**

Convergence Phase 0/1 landed; **Phase 2 is the genuine un-started high-value work**, and it is precisely the axis where agentic lift lives (Pillar 8). Every other open item is hygiene or measurement; this is capability. **Next real lever after the measurement spine.**

---

## 3. The typed-guarantee layer — mid-migration, on-plan (NOT scaffold-debt)

The `2026-06-02-canonical-contracts-and-invariants` spec (dated **today**, `status: design-spec proposed`) defines 5 contracts + 5 invariants that make the recurring failure modes *structurally impossible*. Its §5 migration is **explicitly type-first** ("land the type only; wiring is the next planned step"). So "type shipped, enforcement pending" is the **expected on-track state**, not abandoned scaffold. Status, ranked by **evidence-of-harm**:

| Invariant | State | Rank | Evidence |
|---|---|---|---|
| **I4 — one capability resolver, source-tagged** | ❌ **unconverged — 5 entry points** (`llm-provider/capability-resolver`, `llm-provider/canonical-resolver`, `reasoning/context/profile-resolver`, `reasoning/assembly/capability`, `core/contracts/capability`). `profile-resolver` + `assembly/capability` do **not** call `resolveCanonical`. | 🔴 **EARNED enforcement** | Already caused a real multi-hour bug — #2 `qwen3.5:latest → tier:mid window:2048` silent fallback. This is the one gap with proven harm. |
| **I5 — recency-aware projection, two budgets** | ✅ **enforced** (`assembly/stages/project-results.ts`, recency-split shipped 2026-06-02, pinned by test) | — | The one fully-landed invariant. |
| **I2 — one assembler** | 🟡 **strangler tail** — `project()` won the kernel path; `context-engine.ts` (250 LOC, was 690) survives as `withEnvContext` helper + `ContextManager` residue (9 inbound). A tail, not a competing full assembler. | 🟠 mid | Finish the strangler or formally retain the helper. |
| **I3 — one deliverable channel** | 🟡 `commitDeliverable()` **defined** (`core/contracts/deliverable.ts`), adoption pending. Terminal `state.output` write lives in runtime `finalize/`+`output-assembly`/`output-synthesis`; migration is the planned Phase-α step. | 🟢 low | Brand-new contract (today), tiny surface, explicit plan. The remedy for the thrice-recurring deliverable-leak EXISTS; wiring is scheduled. NOT debt. |
| **I1 — one reducer loop** | ✅ holds (`runner.ts` sole loop; strategies pass through) | — | Codify as test when convenient. |

**Two contracts not yet built** (on the spec's roadmap, Phase α): `ProjectionPolicy` (`core/contracts/projection.ts`) and `PreFlight` (`core/contracts/preflight.ts`). My session's two capability-source gates (bench preflight + runtime build gate) are **the working seed of the PreFlight contract (§2.5)** — they should be unified into the canonical `core/contracts/preflight.ts` `PreFlightReport`/`preflightCheck(builder, task)` rather than living as two ad-hoc gates.

**Contracts shipped as types (Sprint-1 B1/B2/B3, on-plan):** TaskContract, DeliverableProvenance, Capability — all in `core/contracts/`. 3/5.

---

## 4. Structural hygiene — near-done, low-value remainder

| Item | Status | Disposition |
|---|---|---|
| WS-1 release flow | ✅ done (verification typecheck clean, judge-server `private:true`, no v0.10.7 draft) | close |
| WS-2 runtime seam | ✅ done (`Layer.mergeAll`) | close |
| WS-3 kernel DAG | 🟡 ~80% (0 cycles); 16 acyclic sibling-imports could Tag-ify | **low value — metric-gaming risk** ([[feedback_no_metric_gaming_refactor]]); skip unless a cohesion win |
| WS-4 dead surface | 🟡 `@reactive-agents/observe` (1 caller) + `compose` (1 caller) still dead | cheap wire-or-delete |
| WS-5 honesty | 🟡 ceiling tests shipped; 34 `Effect<X,unknown>` remain; +capability-source gates this session | incremental |
| WS-6 cohesion decomp | 🟡 `act.ts` 1209→937 done; `think.ts` 1334 pending (cohesive think/parse/guard clusters); `arbitrator.ts`/`event-bus.ts` correctly LEFT large | think.ts is the one real decomp left |

Stale skill debt-table items (all resolved, do not resurface): `strategies/kernel/` (moved to `kernel/`), `KernelState.meta as any` (0), `context-engine.ts` 690 LOC dead (now 250, largely live helper).

---

## 5. Escalations / decisions for the user

1. **I4 resolver merge** is the one *earned* structural fix (real bug behind it). It's a multi-week refactor per the spec's own §9.3 risk — should be **sequenced AFTER the bench can measure capability-resolution regressions** (which my preflight gate now partly enables). Decision: schedule it, don't rush it.
2. **Capability axis (Pillar 8)** — recitation + experience-reuse is the genuine vision-gap. Decision: is the next sprint capability (convergence Phase 2) or measurement-completion (PreFlight contract + bench honesty)? They compound — measurement-first makes the capability work provable.
3. **think.ts decomp** (WS-6) — the only real structural decomp left; cohesion-gated, safe.

---

## 6. Net health score (qualitative)

| Dimension | Grade | Note |
|---|---|---|
| Layering / dependency rule | A | clean, no upward imports |
| Kernel structure | A | DAG, single arbitrator, state discipline |
| Data-flow canonicalization | A− | project() won kernel; strangler tail remains (I2) |
| Typed-guarantee layer | B | 3/5 contracts as types, on-plan; I4 the earned gap |
| **Capability / compounding intelligence (Pillar 8)** | **D** | **recitation + experience-reuse unstarted — the real vision-gap** |
| Measurement honesty | B+ | `Capability.source` spine + 2 new gates; judge offline, N low |
| Doc/plan accuracy | C→B | was sprint-stale everywhere; frontmatter + cross-ref reconciled this session |

**Overall: a structurally healthy framework with a near-complete migration and one strategic gap (the capability axis) standing between current state and the Pillar-8 vision.** The risk is not architectural rot — it's continuing to polish the cleanliness axis (already an A−) while the capability axis (a D) is where the vision actually lives.
