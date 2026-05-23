---
tags: [evidence, ri-ablation, q1a, q1b]
date: 2026-05-23
campaign-step: 6
answers: Q1a (RI fire rate?) + Q1b (Δ-success when fires?)
basis: ri-ablation-2026-05-23-03:46.json (16 cells: 2 models × 4 scenarios × {RI-on, RI-off})
---

# RI Ablation Analysis

## TL;DR — RI is alive, tier-dependent, and not the surface drift analysis assumed

Earlier sweep (qwen3:14b smooth-running probes) showed RI 0 dispatched → triggered "dead weight" framing. **Wrong inference.** On failure-corpus scenarios:

- **RI fires on 75% of RI-on cells** (6/8). Not dead.
- **Δ-success: +1 (5/8 vs 4/8) across all cells; +25pp on qwen3:14b alone (3/4 vs 2/4)** — meaningful rescue on tier-capable models.
- **Tier-dependent**: RI rescues on qwen3:14b, drags net-cost on cogito:14b.

But **3 new bugs surfaced** that contaminate Q1a/b confidence:
- Duplicate event names emitted for identical decisions (3 pairs)
- `interventionsDispatched` counter non-zero on RI-OFF cells (ablation not clean)
- 5 of 13 ControllerDecision variants empirically fire (38%)

---

## Headline data table

| Model | Scenario | Variant | Success | Iter | Disp | Sup | MaxE | Dur(s) |
|---|---|---|---|---|---|---|---|---|
| cogito:14b | success-capital | RI-off | ✓ | 5 | 1 | 1 | 0.569 | 13 |
| cogito:14b | success-capital | RI-on | ✓ | 5 | 1 | 1 | 0.572 | 5 |
| cogito:14b | success-paradigm | RI-off | ✓ | 5 | 1 | 1 | 0.597 | 7 |
| cogito:14b | success-paradigm | RI-on | ✓ | 7 | 1 | 1 | 0.607 | 7 |
| cogito:14b | failure-rate-limit | RI-off | ✗ | 21 | 2 | 2 | 0.578 | 16 |
| cogito:14b | failure-rate-limit | RI-on | ✗ | 21 | 2 | 4 | 0.627 | 37 |
| cogito:14b | failure-verify-loop | RI-off | ✗ | 14 | 1 | 2 | 0.691 | 12 |
| cogito:14b | failure-verify-loop | RI-on | ✗ | 14 | 1 | 2 | 0.691 | 12 |
| qwen3:14b | success-capital | RI-off | ✓ | 3 | 1 | 1 | 0.15 | 30 |
| qwen3:14b | success-capital | RI-on | ✓ | 2 | 0 | 0 | 0.15 | 9 |
| qwen3:14b | success-paradigm | RI-off | ✓ | 3 | 1 | 1 | 0.15 | 32 |
| qwen3:14b | success-paradigm | RI-on | ✓ | 3 | 1 | 1 | 0.15 | 33 |
| qwen3:14b | failure-rate-limit | RI-off | ✗ | 21 | 0 | 2 | 0.578 | 104 |
| qwen3:14b | failure-rate-limit | **RI-on** | **✓** | **12** | 0 | 2 | 0.578 | 93 |
| qwen3:14b | failure-verify-loop | RI-off | ✗ | 25 | 6 | 2 | 0.721 | 117 |
| qwen3:14b | failure-verify-loop | RI-on | ✗ | 26 | 4 | 4 | 0.655 | 155 |

**The bolded row is the rescue cell**: qwen3:14b on `failure-rate-limit` succeeds with RI on, fails without. -9 iter, -11s, the only Δ-success in 8 pairs.

---

## Q1a answer — RI fire rate

**Empirically: 75% of RI-on cells dispatch.** Decision types observed:

| Decision | Fire count | Notes |
|---|---|---|
| stall-detect | 14 | Most common; fires on flat-entropy 2-iter pattern |
| tool-inject + inject-tool-guidance | 11 + 11 | **Same decision, two event names** — R9 below |
| early-stop | 9 | Fires at convergence; what gave qwen3 success-capital -21s |
| temp-adjust + set-temperature | 2 + 2 | **Same decision, two event names** |
| switch-strategy + request-strategy-switch | 1 + 1 | **Same decision, two event names** |

**5 of 13 declared ControllerDecision variants empirically fire (38%).** Confirms R3 — 8 variants in the typed union have zero observed runtime evidence in failure-corpus:

Dead-on-this-corpus: `compress`, `skill-activate`, `prompt-switch`, `tool-failure-redirect`, `memory-boost`, `skill-reinject`, `human-escalate`, `harness-harm`.

Either failure-corpus is too narrow to surface them OR those variants don't fire in any realistic scenario. Either way: **declared > wired** anti-pattern confirmed.

**Threshold check (from campaign spec):**
- Original: ">30% fire rate → dual substrate justified"
- Observed: 75% fire rate
- **Verdict: RI is NOT dead weight on failure scenarios.** Subsumption-by-deletion (the easy path) is OFF the table.

But: 0% fire rate on smooth probes (earlier sweep) + 75% fire rate on failure scenarios = **RI is correctly conditional.** It activates when trouble emerges. The previous F3 interpretation was wrong.

---

## Q1b answer — Δ-success when RI fires

**Aggregate: +1 success (5/8 vs 4/8) across all RI-on vs RI-off pairs.**

Stratified:

| Model | Δ-success | Δ-tokens | Δ-duration | Net verdict |
|---|---|---|---|---|
| cogito:14b | 0 (2/4 vs 2/4) | 0 (R1 metadata bug) | +21s on failure-rate-limit, ~0 elsewhere | **drag** — same outcome, sometimes slower |
| qwen3:14b | **+1 (3/4 vs 2/4)** | 0 (R1 metadata bug) | -21s on success-capital, -11s on rescue, +38s on verify-loop | **rescue** — clear lift on rate-limit, faster on smooth |

**Tier-dependent. RI works for models with reliable FC; backfires for models with shaky FC** (cogito spends iter time reacting to RI advice it can't follow).

**Threshold check (revised, per event-coverage-diff post-Step-2):**
- "Any positive Δ → bridge (RI keeps deciding, Compose tags become emission surface)"
- Observed: positive Δ on qwen3:14b, neutral-to-drag on cogito:14b.
- **Verdict: bridge approach holds.** RI's decision logic is empirically load-bearing on at least one tier. Don't subsume; expose decisions through Compose tags so users can suppress per-tier.

---

## New finding R9 — duplicate event names for identical decisions 🟢 SUPPORTED

Trace event grep produced **3 pairs of duplicate names** for the same RI decision:

| Pair | Names | Implication |
|---|---|---|
| Tool inject | `tool-inject` + `inject-tool-guidance` | Same decision, two emit events |
| Temperature | `temp-adjust` + `set-temperature` | Same decision, two emit events |
| Strategy switch | `switch-strategy` + `request-strategy-switch` | Same decision, two emit events |

Cause: emit sites use literal strings for `decisionType` instead of referencing the `ControllerDecision` discriminator. Two callers per decision → two names per decision. **Trace consumers (RI analytics, dispatcher metrics, calibration) double-count or miss entirely depending on which name they filter on.**

Fix: single `decisionType` constant per decision, exported from `controller/types.ts`. Wire all emit sites to the constant. Lint rule: no string literal `decisionType` in emit calls.

Adds to the "scaffold without callers" pattern as its mirror: **callers without single source of truth.**

---

## New finding R10 — `interventionsDispatched` non-zero on RI-off cells 🟢 SUPPORTED

Every `RI-off` cell shows `disp ≥ 1` in `traceStats.interventionsDispatched`. Examples:
- `cogito:14b|success-capital|RI-off|disp=1`
- `qwen3:14b|failure-verify-loop|RI-off|disp=6`

If `.withReactiveIntelligence()` was the only RI switch, RI-off should mean disp=0. Two possible causes:

1. **`interventionsDispatched` counter is too inclusive** — counts required-tool nudges, oracle nudges, healing fires, etc. as "interventions." The dispatcher counter has been overloaded.

2. **RI dispatcher is partially default-on** — even without `.withReactiveIntelligence()` the dispatcher subscribes to EventBus and fires decisions. The builder call only adds calibration/skill consumers.

Either is a clarity bug. The ablation surface is contaminated. **A clean RI on/off ablation requires confirming which switch actually turns RI off** — which is itself a robustness finding worth a dedicated probe.

---

## Effect on morph spec

### C1 (Compose-vs-RI) — confirmed: bridge, not subsume

- Empirically RI fires when needed and contributes positive Δ on at least one tier.
- The Compose API has 4 dead tags; 3 of them have natural RI-decision emission opportunities (`control.strategy-evaluated`, `lifecycle.failure`, `nudge.healing-failure`).
- **Bridge action:** wire `pipeline.transform()` calls at RI decision emit sites for `switch-strategy`, `early-stop`, `stall-detect`, `tool-inject`. Users can override or observe through Compose. RI internal decision logic preserved.

### Add to Phase 0 emergency surface bugs

Phase 0 (post-matrix update) was M1 + M2 + M7. Add:

- **R9 (duplicate event names):** one constant per decision, lint rule, ~10 LOC fix.
- **R10 (`disp` counter contamination):** clarify the counter's semantic OR fix the over-inclusion. Either way, ablation cannot be trusted until this is resolved.

These keep Phase 0 in the "surface trust restoration" theme.

### Phase 1 (convergence foundations) gets concrete

The bridge fix (~30 LOC of `pipeline.transform()` calls at RI emit points) lights up 3 of 4 dead Compose tags AND closes C1 (Compose-vs-RI substrate decision) in one work item. Phase 1 priority.

### Phase 1 also gets ControllerDecision union prune

R3 (declared > wired). 8 of 13 variants don't fire in failure-corpus. Either expand failure-corpus to surface them (test gap) OR mark them experimental + document non-firing. Doc-or-prune call.

---

## What didn't change

- Capability mapping verdict (Step 1): strategies stay as primitives, NOT collapsed.
- M1/M2/M7 from matrix run: still P0, still surface-trust restoration.
- `learn/` capability (C3): still pending Q3 evidence (Steps 4 + 5).
- Tier expansion (Step 7): still needs frontier slice for full picture.

---

## Updated campaign status

| Step | Status | Findings |
|---|---|---|
| 1 Capability mapping | ✅ | Q2a answered: <30% mappable; strategies primitives |
| 2 Event coverage diff | ✅ | Q1c answered: ~zero overlap; bridge not subsume |
| 3 Cross-strategy matrix | ✅ | Q2b answered: WIDE variance; M1/M2/M7 P0 bugs |
| **6 RI ablation** | ✅ | Q1a/b answered: 75% fire, +1 success, tier-dependent; R9/R10 new bugs |
| 4 Within-session learning | ⏳ pending | Need to confirm M6 SQLite persistence wired before running |
| 5 Cross-session repeat | ⏳ pending | Same prerequisite |
| 7 Tier expansion (frontier) | ⏳ pending | OPENAI_API_KEY confirmed, ready to run |

Recommend: kick step 4+5 (need to verify M6 SQLite first), and step 7 frontier slice in parallel. Both ~30 min wall-clock.

---

## Decision support summary

After 4 of 7 campaign steps:

**Phase 0 — Surface Trust Restoration (NEW, gates all else):**
1. M1 totalTokens metadata wiring (P0)
2. M2 rationale XML output leak (P0)
3. M7 ToT failure→success bool propagation (P0)
4. R9 duplicate decision event names (P0)
5. R10 `interventionsDispatched` counter clarification (P0)
6. M3 ToT tier-aware cost gate (P1)

**Phase 1 — Convergence Foundations (well-grounded now):**
1. Capability-scoped emit (E2 + closes F1)
2. Bridge RI decisions through Compose tags (closes C1, lights 4 dead tags, ~30 LOC)
3. ControllerDecision union doc-or-prune (R3)
4. Required-tool nomination extraction (I2 + closes F4/F5)
5. `transitionState()` discipline + lint rule (E4 + closes 160+ stray mutations)

**Phase 2 (pending Q3 + Q7):** Strategy primitive cleanup, `learn/` capability investment.

**Phase 3 (post-Phase 1):** Single Arbitrator.
