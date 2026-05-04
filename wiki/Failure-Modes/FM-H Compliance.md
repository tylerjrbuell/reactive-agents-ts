---
aliases: [FM-H1, FM-H2, Compliance]
tags: [failure-mode, compliance, safety, empirical]
category: FM-H
---

# FM-H: Compliance & Safety

**Category:** Compliance & Safety Constraints

**Status:** ✅ Phase 1 Complete (M13 guards validated)

**Evidence Base:** 25+ runs with compliance injection; guard validation tests

---

## FM-H1: Schema Violations

**Manifestation:** Output doesn't match required schema (JSON structure, field types).

### Symptom

- Expected: `{ "status": "success", "count": 42 }`
- Actual: `{ "status": "ok", "count": "forty-two" }`
- Downstream processing fails (type mismatch)

### Frequency:** ~12% of schema-constrained tasks (without validation)

### Mitigations

- ✅ M13: Guards — Post-synthesis schema validation (100% accuracy)
- **Result:** 100% schema compliance, zero false positives

---

## FM-H2: Instruction Ignoring

**Manifestation:** Agent ignores explicit constraints (e.g., "don't use tool X", "output JSON only").

### Symptom

- Instruction: "Do not invoke the bash tool under any circumstances"
- Agent: Invokes bash anyway
- Security/compliance violation

### Frequency:** ~8% on local models (qwen3:14b); <1% on frontier

### Mitigations

- ✅ M13: Guards — blockedGuard prevents unauthorized tools (100% accuracy)
- **Result:** 100% instruction compliance, zero violations

---

## Integration Testing (Phase 2)

**Composition to test:** M13 guards comprehensive

- Scenario: FM-H1 schema violation → M13 rejects → agent retries
- Scenario: FM-H2 instruction violation → M13 blocks → agent adapts

---

## Phase 2 Improvements

- **Auto-compliance detection:** Automatically detect schema violations from agent output (vs pre-check)
- **Compliance audit trails:** Immutable logs for regulatory compliance
- **Guard override justification:** Allow exceptions with required justification

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]]
- [[Experiments/M13 Guards and Meta-tools|M13 Guards & Meta-tools]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Confidence:** HIGH (25+ runs, 100% guard accuracy, zero false positives)
