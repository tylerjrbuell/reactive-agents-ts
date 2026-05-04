---
aliases: [M# Name]
tags: [experiment, mechanism, spike]
mechanism: M#
verdict: KEEP|IMPROVE|REMOVE
date: YYYY-MM-DD
owner: Team Name
---

# M# Mechanism Name

**Mechanism:** M# — [Brief description of what this mechanism does]

**Owner:** [Team responsible for this mechanism]

**Verdict:** [KEEP|IMPROVE|REMOVE]

---

## Overview

[One paragraph describing the mechanism's purpose and how it fits into the system.]

---

## Success Criteria

- [ ] Criterion 1: [Measurable outcome]
- [ ] Criterion 2: [Measurable outcome]
- [ ] Criterion 3: [Measurable outcome]

---

## Phase 1 Validation

### Test Results

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Test Pass Rate | X% | 100% | ✅/❌ |
| Coverage | X% | >85% | ✅/❌ |
| Performance | Xms | <Yms | ✅/❌ |
| Accuracy Lift | +Xpp | >0pp | ✅/❌ |

### Evidence

- **Test file:** `packages/.../tests/M#-*.test.ts`
- **Measurement file:** `docs/superpowers/debriefs/M#-mechanism-name-validation.md`
- **Harness report:** `harness-reports/phase-1-mechanism-validation-2026-05-04.md`

### Key Findings

1. [Finding 1 with evidence]
2. [Finding 2 with evidence]
3. [Finding 3 with evidence]

---

## Verdict Rationale

### Why This Verdict

[2-3 sentences explaining why this mechanism earns its verdict.]

### Trade-offs

- **Pro:** [Benefit of this mechanism]
- **Con:** [Cost of maintaining this mechanism]
- **Mitigations:** [How we address the cons]

---

## Phase 1.5 Improvements (If IMPROVE)

### Gap

[What needs improvement]

### Action

[Specific action to take in Phase 1.5]

### Success Criteria

- [ ] Improvement criterion 1
- [ ] Improvement criterion 2
- [ ] Improvement criterion 3

**Owner:** [Team responsible]

---

## Integration Points

- **Used by:** [Which other mechanisms depend on this]
- **Depends on:** [Which mechanisms this depends on]
- **Composes with:** [Which mechanisms combine well with this]

---

## References

- [[MOCs/Research MOC|Research MOC]] — All Phase 1 mechanism validation results
- [[Experiments/Phase 1 Mechanism Validation|Phase 1 Results]] — Complete verdict summary
- [[Failure-Modes/00 FM Catalog|Failure Modes]] — Modes this mechanism mitigates

---

**Last Updated:** [Date]  
**Phase:** Phase 1 Validation  
**Status:** [Complete/Pending/In Progress]
