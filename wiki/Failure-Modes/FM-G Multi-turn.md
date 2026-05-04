---
aliases: [FM-G1, FM-G2, Multi-turn]
tags: [failure-mode, multi-turn, empirical]
category: FM-G
---

# FM-G: Multi-Turn Coherence

**Category:** Multi-Turn Coherence & Sub-Agent Failures

**Status:** 🔄 Phase 1 Complete (test harness ready; real LLM validation Phase 1.5)

**Evidence Base:** 15+ multi-turn runs; 10 sub-agent delegation scenarios

---

## FM-G1: Coherence Loss

**Manifestation:** Agent loses coherence or contradicts itself across multiple turns.

### Symptom

- Turn 1: Agent says "The healing pipeline has 4 stages"
- Turn 5: Agent says "The healing pipeline has 3 stages"
- User confusion; inconsistent context

### Frequency:** ~5% of multi-turn conversations (>10 turns)

### Mitigations

- ✅ M10: Memory System — Episodic + procedural layers preserve context
- ✅ M6: Skill System — Skills enable consistent behavior patterns
- 🔄 Phase 1.5: M10 multi-session validation

---

## FM-G2: Sub-Agent Failures

**Manifestation:** Delegated sub-agent produces invalid output; failures propagate.

### Symptom

- Agent delegates research task to sub-agent
- Sub-agent hallucinates response
- Parent agent trusts and uses hallucinated data
- Downstream tasks corrupted

### Frequency:** ~8% of delegation scenarios without error containment

### Mitigations

- ✅ M8: Sub-agent Delegation — Error containment (0% cascade; structured errors)
- ✅ M11: Diagnostic System — Validates sub-agent output quality
- 🔄 Phase 1.5: M8 real LLM validation (accuracy lift on delegation)

---

## Integration Testing (Phase 2)

**Composition to test:** M10 + M8

- Scenario: Multi-turn with delegated steps → M10 memory preserves context → M8 error containment
- Scenario: Sub-agent delegation → output validated by M11 → parent agent uses with confidence

---

## Phase 1.5 Improvements

### Gap 1: Natural Multi-Turn Scenarios

**Problem:** Coherence loss tested in isolation; natural conversation patterns need validation

**Solution:** Design realistic multi-turn conversations with semantic consistency requirements

**Success Criteria:** >90% coherence on multi-turn conversations

### Gap 2: Sub-Agent Real LLM Metrics

**Problem:** Delegation accuracy only tested on mock LLMs

**Solution:** Full execution with frontier + qwen3 models

**Success Criteria:** Confirm accuracy lift ≥15% on complex delegation tasks

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]]
- [[Experiments/M10 Memory System|M10 Memory System]]
- [[Experiments/M8 Sub-agent Delegation|M8 Sub-agent Delegation]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 validation pending  
**Confidence:** MEDIUM (test harness ready; real LLM validation needed)
