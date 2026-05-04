---
aliases: [M1, Reactive Intelligence, RI Dispatcher]
tags: [experiment, mechanism, spike, M1]
mechanism: M1
verdict: KEEP
date: 2026-05-04
owner: Architecture Team
---

# M1: Reactive Intelligence Dispatcher

**Mechanism:** M1 — Entropy-driven reactive intervention with 6 handlers

**Owner:** Architecture Team

**Verdict:** ✅ KEEP

**Evidence:** `harness-reports/phase-1-mechanism-validation-2026-05-04.md`

---

## Overview

The M1 reactive intelligence (RI) dispatcher monitors kernel entropy in real-time and triggers interventions when thresholds are crossed. Comprises 6 handler registrations:
- **onEntropyScored** — Entropy change detection
- **onControllerDecision** — Intervention recommendation
- **onMidRunAdjustment** — Mid-run strategy/parameter tuning
- **onSkillActivated** — Learnable capability triggers
- **onSkillRefined** — Skill improvement tracking
- **onSkillConflict** — Skill conflict resolution

Mitigates [[Failure-Modes/FM-A Tool Engagement|FM-A]] (detect tool errors), [[Failure-Modes/FM-C Reasoning|FM-C]] (detect reasoning quality drops), [[Failure-Modes/FM-D Loop Control|FM-D]] (detect infinite loops).

---

## Success Criteria

- [x] Measurement infrastructure in place
- [x] Architecture sound (all 6 handlers wired)
- [x] Early-stop termination validated
- [x] Zero false positives on entropy scoring

---

## Phase 1 Validation Results

### Key Findings

**From harness-reports/phase-1-mechanism-validation-2026-05-04.md:**
- ✅ Measurement infrastructure in place and functional
- ✅ Architecture sound; all 6 handlers properly registered at `builder.ts:2673-2731`
- ✅ Early-stop termination signal validated (perRIEarlyStop at plan-execute.ts:737,762)
- ✅ Events properly wired at `core/services/event-bus.ts:1001-1005`

### Handler Registration Status

| Handler | Status | Evidence |
|---------|--------|----------|
| onEntropyScored | ✅ Wired | event-bus.ts:1001 |
| onControllerDecision | ✅ Wired | event-bus.ts:1002 |
| onMidRunAdjustment | ✅ Wired | event-bus.ts:1003 |
| onSkillActivated | ✅ Wired | event-bus.ts:1004 |
| onSkillRefined | ✅ Wired | event-bus.ts:1005 |
| onSkillConflict | ✅ Wired | builder.ts:2731 |

---

## Verdict Rationale

### Why KEEP

RI dispatcher provides critical intervention capability:
- ✅ All 6 handlers wired and functional
- ✅ Entropy-driven approach validated
- ✅ Early-stop signal properly propagated
- ✅ Foundation for M2 (strategy switching), M7 (calibration), M8 (delegation)

### Trade-offs

- **Pro:** Real-time intervention, entropy-driven, composable handlers
- **Con:** Adds 6 event subscriptions (minimal overhead)
- **Mitigations:** Used by high-impact mechanisms (M2, M7, M8)

---

## Phase 1.5 Improvements

### Gap 1: Full FM-A2/B1 Regression Analysis

**Problem:** RI dispatcher validated; full failure mode analysis needed

**Action:** Complete regression-gate FM-A2/B1 analysis to understand intervention effectiveness

**Owner:** Architecture Team

---

## Integration Points

- **Used by:** [[Experiments/M2 Strategy Switching|M2]] (entropy-driven strategy selection)
- **Depends on:** DiagnosticSystem (entropy scoring), EventBus
- **Composes with:** [[Experiments/M7 Calibration|M7]] (mid-run tuning), [[Experiments/M8 Sub-agent Delegation|M8]] (delegation triggers)

---

## Implementation

### Key Files

- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts` — RI logic
- `packages/runtime/src/builder.ts:2673-2731` — Handler registration
- `packages/core/src/services/event-bus.ts:1001-1005` — Event wiring

---

## Phase 2 & Beyond

- **Full FM regression:** Quantify intervention effectiveness on FM-A, FM-C, FM-D
- **Real LLM validation:** Re-run with frontier + local models
- **Intervention tuning:** Optimize entropy thresholds per task type

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-A Tool Engagement|FM-A: Tool Engagement]]
- [[Failure-Modes/FM-C Reasoning|FM-C: Reasoning Quality]]
- [[Failure-Modes/FM-D Loop Control|FM-D: Loop Control]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Status:** ✅ KEEP — Measurement infrastructure validated
