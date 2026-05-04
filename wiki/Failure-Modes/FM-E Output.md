---
aliases: [FM-E1, FM-E2, Output Quality]
tags: [failure-mode, output-quality, empirical]
category: FM-E
---

# FM-E: Output Quality

**Category:** Output Quality & Completeness

**Status:** ✅ Phase 1 Complete (diagnostic system validates)

**Evidence Base:** 25+ runs measuring output quality across dimensions

---

## FM-E1: Empty Content

**Manifestation:** Output is blank, null, placeholder, or incomprehensible gibberish.

### Symptom

- Expected: "Here is the summary: ..."
- Actual: "" or "null" or "[INCOMPLETE]"
- User sees no value

### Frequency:** ~3% of runs (rare)

### Mitigations

- ✅ M11: Diagnostic System — Output quality validation flags empty content
- ✅ M3: Verifier — Semantic entropy detects no meaningful signal

---

## FM-E2: Fabricated Specifics

**Manifestation:** Output contains confident but false details (hallucination).

### Symptom

- Agent claims: "The healing pipeline has 7 stages" (actually 4 stages)
- Agent provides specific metrics: "90% accuracy" (actually 86.7%)
- User trusts false information

### Frequency:** ~10% of runs on complex topics

### Mitigations

- ✅ M3: Verifier — Semantic entropy + NLI consistency detects contradictions
- ✅ M11: Diagnostic System — Confidence scoring on factual claims
- ✅ M13: Guards — Post-synthesis validation against schema

---

## Integration Testing (Phase 2)

**Composition to test:** M3 + M11 + M13

- Scenario: FM-E2 fabrication detected by M3 verifier → retry with evidence requirement
- Scenario: FM-E2 post-synthesis detected by M13 guards → reject and retry

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]]
- [[Experiments/M3 Verifier and Retry|M3 Verifier & Retry]]
- [[Experiments/M11 Diagnostic System|M11 Diagnostic System]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Confidence:** HIGH (diagnostic validation 100% accurate)
