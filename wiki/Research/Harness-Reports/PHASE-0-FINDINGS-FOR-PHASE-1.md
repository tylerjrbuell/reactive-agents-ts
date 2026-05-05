# Phase 0 Findings & Phase 1 Implications

**Date:** 2026-05-03  
**Purpose:** Review Phase 0 completion and extract findings that should shape Phase 1's validation gates

---

## Phase 0 Completion Summary

✅ **ALL GATES PASSED:**
- **Reproducibility:** 0% delta (perfect reproducibility across runs)
- **Rule-4 Guard:** Self-evaluation prevention working correctly
- **Metadata tracking:** SessionReport.reproducibility fully populated
- **Regression test:** Automated framework in place for future phases

**Key achievement:** A frozen, containerized, deterministic judge service is now the foundation for all Phase 1+ validation gates.

---

## Critical Enabler for Phase 1

**What Phase 0 unlocked:**
1. **Reproducible benchmarking infrastructure** — We can now run the same task suite twice and get identical results (0% variance). This is the prerequisite for measuring "before/after" lift on any mechanism.
2. **Rule-4 enforcement** — Prevents self-grading (judge ≠ SUT model). This eliminates the self-preference bias that would confound Phase 1's spike measurements.
3. **Deterministic judge container** — Judge code SHA is pinned; model is pinned. Judge drift is eliminated as a confound.

**Phase 1 dependency:** Every mechanism's spike measurement MUST run through this frozen judge. Without it, "lift" claims are meaningless.

---

## The 13 Mechanisms Phase 1 Must Validate

From `docs/spec/docs/AUDIT-overhaul-2026.md` §6:

| # | Mechanism | Package(s) | Failure modes addressed | Current status |
|---|---|---|---|---|
| **M1** | Reactive Intelligence dispatcher (entropy → intervention) | `reactive-intelligence/` + hooks in `reasoning/` | FM-B1 (mitigated), FM-A2/H1 (open) | _pending validation_ |
| **M2** | Strategy switching (ReAct ↔ Plan-Execute ↔ ToT) | `reasoning/strategies/` | FM-B2, FM-D2 (open) | _pending validation_ |
| **M3** | Verifier + retry | `reasoning/kernel/capabilities/verify/` | FM-A1 (mitigated p01b), FM-C2 (control hook) | Spike `p01b` shows potential but incomplete |
| **M4** | Healing pipeline (4 stages) for FC failures | `tools/` (NativeFCDriver+TextParseDriver) | FM-A2 (claimed) | _pending validation_ |
| **M5** | Context curation: dual compression | `reasoning/kernel/utils/` | FM-F1 (open, coordination issue) | Confirmed coordinated (Apr 29) |
| **M6** | Skill system (lifecycle, AgentEvents, RI hooks) | `reasoning/`, `reactive-intelligence/` | Learning pillar | _pending validation_ |
| **M7** | Calibration (3-tier, observation store) | `reactive-intelligence/`, `llm-provider/` | FM-A2 (calibration reliability) | 3/14 fields active; mostly unused |
| **M8** | Sub-agent delegation (`agent-tool-adapter`) | `tools/`, `runtime/` | FM-G1 (unvalidated) | _pending validation_ |
| **M9** | Termination oracle (Arbitrator) | `reasoning/kernel/` | FM-D1 (9-path scatter problem) | ✅ **Fixed (May 1)** — single-owner termination wired |
| **M10** | Memory system (Working/Semantic/Episodic) | `memory/` | FM-F2 (theoretical) | _pending validation_ |
| **M11** | Diagnostic system (Sprint 3.6) | `diagnose/` | FM-A3 (output leak fix) | _pending validation_ |
| **M12** | Provider adapter system (7 hooks) | `llm-provider/` | Quality-of-life across tiers | ✅ **All 7 hooks wired (Apr 30)** |
| **M13** | Guards + meta-tools registry | `reasoning/kernel/phases/` | FM-D1 (premature termination) | _pending validation_ |

---

## Phase 1 Decision Points

### What Phase 0 Evidence Suggests About Each Mechanism

**Strong candidates for immediate validation spikes (likely to pass):**
- **M9 (Termination oracle)** — Already fixed & tested. Spike should be quick verification.
- **M12 (Provider adapter)** — All 7 hooks wired. Spike should validate each hook fires correctly.
- **M5 (Context curation)** — Confirmed coordinated. Spike should measure compression ratio before/after.

**High-risk for sunset (likely to fail validation):**
- **M7 (Calibration)** — Audit found only 3/14 fields active. Phase 1 spike should either activate ≥8 fields or sunset it.
- **M10 (Memory system)** — Theoretical; no evidence of usage. Will need actual test scenario or sunset.
- **M4 (Healing pipeline)** — "Claimed" but unvalidated. Spike must demonstrate measurable lift on FC failure mode.

**Medium-risk (need to clarify mechanism first):**
- **M1 (RI dispatcher)** — FM-B1 mitigated but A2/H1 open. Spike should clarify which FM it actually solves.
- **M2 (Strategy switching)** — B2/D2 open. Spike: when does switching beat a single strategy?
- **M3 (Verifier)** — Spike `p01b` showed potential but incomplete. Phase 1 should extend p01b or find new failure mode.
- **M6 (Skill system)** — Learning pillar is abstract. Phase 1 spike should define measurable "learning" outcome.
- **M8 (Sub-agent delegation)** — Unvalidated. Spike should measure delegation vs. inline execution.
- **M11 (Diagnostic)** — Output leak fix is tactical. Phase 1 spike should measure output integrity.
- **M13 (Guards)** — Related to M9 (termination). Spike should measure guard rejection rates.

---

## Phase 1 Validation Gate — Refined

Based on Phase 0 and the mechanism inventory, Phase 1's gate should be:

### Gate 1: Evidence or Sunset (Mandatory)
**Every mechanism must have either:**
- A spike report showing quantified lift (% improvement on a tracked failure mode), OR
- A `_unstable_sunset_v0_11_*` marker with documented removal date

**CI enforcement:** After Phase 1, lint fails on any mechanism lacking both evidence and sunset marker.

### Gate 2: LOC Reduction (Mandatory)
**Aggregate harness LOC drops ≥5%.**

Current rough counts (from audit):
- `builder.ts` = 5,877 LOC
- `execution-engine.ts` = 4,476 LOC
- `runner.ts` = 1,706 LOC
- `plan-execute.ts` = 54.2K (largest strategy module)
- **Total critical files:** ~70K LOC

**Target:** 70K → 66.5K (5% reduction)

This forces actual deletions of unvalidated mechanisms, not just doc marking.

### Gate 3: No Regression (Mandatory)
**All 4,672 existing tests pass.** Phase 1 spikes may add new tests, but must not break existing ones.

---

## Recommended Phase 1 Sequencing

**Fast-track (parallel dispatch, 1 week):**
1. M9 verification spike (termination oracle — already fixed, quick validation)
2. M12 hook-firing spike (provider adapter — all wired, verify each fires)
3. M5 compression-ratio spike (context curation — measure before/after)

**Medium-track (parallel dispatch, 2 weeks):**
4. M7 calibration activation spike (activate ≥8 fields or sunset)
5. M4 healing-pipeline spike (measure FC failure recovery or sunset)
6. M1/M2 strategy-choice spike (when does switching beat single strategy?)

**Slow-track (sequential, can defer to Phase 1.5):**
7. M3 verifier extension (build on p01b or find new FM)
8. M6 skill-learning spike (define measurable "learning" outcome)
9. M8 delegation spike (dispatch vs. inline execution)
10. M10 memory spike (actual usage scenario or sunset)
11. M11 diagnostic spike (output integrity)
12. M13 guard rejection spike (guard firing rates)

---

## Impact on Phase 1 Detailed Plan

The detailed plan (`2026-MM-DD-phase-1-mechanism-validation-sweep.md`) should:

1. **List each mechanism's spike design** — what failure mode is it testing? what is "lift"? (e.g., M4: healing pipeline lift = % of FC failures recovered without human intervention)
2. **Assign each spike to a subagent** — dispatch all 13 in parallel where dependencies allow
3. **Set sunset criteria per mechanism** — e.g., "M7 requires ≥8 of 14 calibration fields actively consumed; otherwise sunset"
4. **Define "lift" quantitatively per mechanism** — e.g., "M2 switch-to-ToT spike: qwen3 accuracy on complex tasks +15% vs. reactive-only"
5. **LOC reduction audit** — at end of phase, re-count `builder.ts`, `execution-engine.ts`, `runner.ts`, `plan-execute.ts`; confirm ≥5% aggregate drop

---

## What Could Go Wrong in Phase 1

**Stop-the-line scenarios** (per master roadmap §6.2):
- Spike shows mechanism is harmful (negative lift) → sunset it, don't retry
- 3+ consecutive mechanism spikes fail their TDD gates → abandon phase, re-analyze assumption
- LOC actually increases instead of decreasing → mechanism cleanup failed, revert and revise

**Early indicators of trouble:**
- Spikes take >2 hours each (means mechanism is too complex; decompose spike differently)
- LOC drops <2% by week 2 (means sunsets aren't being executed; revisit sunset decisions)
- Test failures emerge in existing tests during spike work (means spike changed shared code; isolate spike better)

---

## Handoff to Phase 1 Planner

**Ready to write `2026-MM-DD-phase-1-mechanism-validation-sweep.md`?**

Ask me:
- Which mechanisms should be fast-tracked (parallel spikes starting immediately)?
- Should we batch-sunset low-priority mechanisms (M10, M11) to simplify Phase 1, or give each a full spike?
- Do we need preliminary meetings with mechanism owners (RI, tools, reasoning) to align on spike design, or can subagents design spikes autonomously per Rule 5?

---

*This document is the bridge between Phase 0 (foundation) and Phase 1 (validation). Use it to refine Phase 1's gate criteria before writing the detailed plan.*
