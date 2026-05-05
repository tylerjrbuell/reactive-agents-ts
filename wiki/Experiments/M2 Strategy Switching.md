---
aliases: [M2, Strategy Switching, Adaptive Reasoning]
tags: [experiment, mechanism, spike, M2]
mechanism: M2
verdict: KEEP
date: 2026-05-04
owner: Reasoning Team
---

# M2: Strategy Switching

**Mechanism:** M2 — Entropy-driven strategy selection (raw, naive, todo, plan-execute, tree-of-thought)

**Owner:** Reasoning Team

**Verdict:** ✅ KEEP

**Evidence:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`

---

## Overview

M2 automatically selects the best reasoning strategy based on task entropy and complexity. Five strategies available:
1. **raw** — Direct LLM response (simplest tasks)
2. **naive** — Single-turn with tool use
3. **todo** — Break task into steps
4. **plan-execute** — Plan then execute with feedback
5. **tree-of-thought** — Explore multiple reasoning paths

Mitigates [[Failure-Modes/FM-C Reasoning|FM-C]] (reasoning quality drops on complex tasks) by matching strategy to complexity.

---

## Success Criteria

- [x] 20+ passing tests validating switching heuristics
- [x] Switching heuristics validated
- [x] Strategy selection accurate for test cases
- [x] Zero regressions on single-strategy baseline

---

## Phase 1 Validation Results

### Key Findings

**From wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md:**
- ✅ 20 passing tests; switching heuristics validated
- ✅ Strategy selection heuristics proven effective
- ✅ Zero regressions from strategy switching
- ✅ Requires real LLM validation in Phase 1.5 for optimal heuristics

### Test Coverage

| Aspect | Tests | Pass | Status |
|--------|-------|------|--------|
| Strategy selection logic | 8 | 8 | ✅ |
| Switching heuristics | 6 | 6 | ✅ |
| Integration with RI | 4 | 4 | ✅ |
| Regression (baseline) | 2 | 2 | ✅ |
| **Total** | **20** | **20** | **✅** |

---

## Verdict Rationale

### Why KEEP

Strategy switching delivers on complexity handling:
- ✅ 20 tests validate switching logic
- ✅ Heuristics proven effective on test cases
- ✅ Zero regressions from baseline
- ✅ Foundation for adaptive reasoning

### Trade-offs

- **Pro:** Adapts to task complexity, composable with M1 RI
- **Con:** Switching heuristics need real LLM tuning; currently opt-in
- **Mitigations:** Phase 1.5 real LLM validation, Phase 2 default-enable

---

## Phase 1.5 Improvements

### Gap 1: Real LLM Validation

**Problem:** Switching heuristics validated on test cases; real LLM behavior may differ

**Action:** Full execution with frontier + local models for optimal heuristics

**Success Criteria:** Strategy accuracy ≥80% on real-world tasks

**Owner:** Reasoning Team

---

## Phase 2 Improvements

- **Default enabling:** Enable strategy switching by default for multi-step tasks
- **Heuristic tuning:** Tune entropy thresholds based on Phase 1.5 data
- **Per-model strategies:** Model-specific strategy selection via calibration

---

## Implementation

### Key Files

- `packages/reasoning/src/strategies/` — Strategy implementations
- `packages/reasoning/src/strategies/strategy-evaluator.ts` — Selection logic
- `packages/reasoning/tests/strategy-switching.test.ts` — Validation

### Configuration

```typescript
// Currently opt-in via ReactiveInput config
const agent = builder.build({
  reasoning: {
    strategySwitching: { enabled: true }
  }
});
```

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-C Reasoning|FM-C: Reasoning Quality]]
- [[Decisions/Strategy Routing Decision|Strategy Routing Decision]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; real LLM validation Phase 1.5  
**Status:** ✅ KEEP — Shipped opt-in; default-enable Phase 2
