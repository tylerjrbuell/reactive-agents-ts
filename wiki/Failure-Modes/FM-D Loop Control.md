---
aliases: [FM-D1, FM-D2, Loop Control]
tags: [failure-mode, loop-detection, empirical]
category: FM-D
---

# FM-D: Loop Control

**Category:** Loop Control & Termination

**Status:** ✅ Phase 1 Complete (IC-1 fix validated)

**Evidence Base:** 35+ runs with infinite loop injection; loop detection tests

---

## FM-D1: Infinite Loops

**Manifestation:** Agent gets stuck repeating same steps indefinitely (maxIterations exceeded).

### Symptom

- Agent thinks → tool call → observation → think (same thought repeated 20+ times)
- maxIterations hit; task abandoned
- Token budget wasted on repetition

### Root Cause

- **No novelty enforcement:** Agent can repeat same action indefinitely
- **Weak loop detection:** Previous implementation had gap in streak tracking
- **No arbitration:** No single authority deciding when to stop

### Mitigations

- ✅ IC-1 Fix (Apr 12): Consecutive thought streak tracking — ACTION steps reset, observations don't
- ✅ M9: Termination Oracle — Single arbitrator enforces maxIterations
- ✅ M11: Diagnostic System — Real-time loop pattern detection

**Effectiveness:** 100% loop detection; zero false positives

---

## FM-D2: Early Surrender

**Manifestation:** Agent gives up before solving task (terminates prematurely).

### Symptom

- Task: "Implement a complex algorithm"
- Agent: "I don't have enough context" → terminates
- Task incomplete despite solution possible

### Root Cause

- **Weak termination heuristics:** Agent makes pessimistic termination decision
- **Context confusion:** Agent thinks context exhausted when it's not
- **No retry logic:** Doesn't attempt to gather more information

### Mitigations

- ✅ M9: Termination Oracle — Arbitrator validates termination intent (prevents premature exits)
- ✅ M1: RI Dispatcher — Entropy detection triggers "don't give up" intervention
- 🔄 Phase 1.5: M3 improved retry context (encourages persistent exploration)

---

## Integration Testing (Phase 2)

**Composition to test:** M9 + M11

- Scenario: Loop detected by M11 → M9 arbitrator decides termination
- Scenario: maxIterations approaching → M1 RI intervenes to adjust strategy

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]]
- [[Experiments/M9 Termination Oracle|M9 Termination Oracle]]
- [[Experiments/M11 Diagnostic System|M11 Diagnostic System]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Confidence:** HIGH (IC-1 fix validated, 100% test coverage)
