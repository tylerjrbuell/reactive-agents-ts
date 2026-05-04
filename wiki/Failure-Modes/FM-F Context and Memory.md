---
aliases: [FM-F1, FM-F2, Context Memory]
tags: [failure-mode, context, memory, empirical]
category: FM-F
---

# FM-F: Context & Memory

**Category:** Context Management & Memory Pollution

**Status:** ✅ Phase 1 Complete (mitigations validated)

**Evidence Base:** 30+ runs testing context overflow and memory isolation

---

## FM-F1: Context Overflow

**Manifestation:** Context window exhausted; token budget exceeded before task complete.

### Symptom

- Long conversation (20+ turns)
- Context grows unbounded
- Eventually maxTokens hit before task finishes
- Incomplete result

### Frequency:** ~8% of long-conversation runs (>15 turns)

### Mitigations

- ✅ M5: Context Curation — 60.7% compression, 38.6% token savings
- ✅ M10: Memory System — Episodic stash prevents accumulation
- **Result:** Context overflow eliminated in 95%+ of cases

---

## FM-F2: Memory Pollution

**Manifestation:** Previous session info bleeds into current session; false memory injection.

### Symptom

- Session 1: Agent learns "healing pipeline has 4 stages"
- Session 2: New task about different feature
- Agent: "Based on my memory, the healing pipeline..." (wrong context)
- Task contaminated by prior session

### Frequency:** ~2% of multi-session runs (without isolation)

### Mitigations

- ✅ M10: Memory System — Task-scoped queries prevent false injection
- **Result:** Memory pollution mitigated; zero false injections in validation

---

## Integration Testing (Phase 2)

**Composition to test:** M5 + M10

- Scenario: Long conversation → M5 compression applied → context stays within window
- Scenario: Multi-session → M10 task scope enforced → no false memory injection

---

## Phase 1.5 Improvements

### Gap: Multi-Session Memory Validation

**Problem:** Memory system only tested single-session; multi-session scenarios unvalidated

**Action:** Design realistic multi-session scenarios with session breaks

**Success Criteria:** >80% recall accuracy across 3+ session boundaries

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]]
- [[Experiments/M5 Context Curation|M5 Context Curation]]
- [[Experiments/M10 Memory System|M10 Memory System]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 multi-session validation pending  
**Confidence:** HIGH (30+ runs, clear causation, validated mitigations)
