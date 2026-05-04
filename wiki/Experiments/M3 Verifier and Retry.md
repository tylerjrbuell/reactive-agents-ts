---
aliases: [M3, Verifier, Retry, Output Verification]
tags: [experiment, mechanism, spike, M3]
mechanism: M3
verdict: IMPROVE
date: 2026-05-04
owner: Reasoning Team
---

# M3: Verifier & Retry

**Mechanism:** M3 — Semantic verification gate + adaptive retry context

**Owner:** Reasoning Team

**Verdict:** 🔄 IMPROVE

**Evidence:** `.agents/MEMORY.md` (M3 spike validated, retry context tuning needed for cogito:14b)

---

## Overview

M3 provides two-stage output quality validation:
1. **Verification Gate** — Semantic entropy + NLI consistency checking
2. **Adaptive Retry** — Model-specific retry prompts addressing FM-A1 (no-tool-fabrication), FM-C2 (long-form regression)

Mitigates [[Failure-Modes/FM-E Output|FM-E]] (empty content, fabricated specifics) and [[Failure-Modes/FM-C Reasoning|FM-C]] (reasoning quality drops).

---

## Success Criteria

- [x] Verifier gate production-ready (100% TP, 0% FP)
- [x] Retry effectiveness tier-specific
- [x] Core mechanism validated
- [ ] Retry effective on cogito:14b (Phase 1.5)
- [ ] Improved context design tested on all tiers (Phase 1.5)

---

## Phase 1 Validation Results

### Verifier Gate Validation

**From .agents/MEMORY.md M3 spike:**
- ✅ Verifier precision 100% on cogito:8b fabrication (target ≥90%)
- ✅ 22 unit tests + 43 expectations all passing
- ✅ Integration contracts validated (verifier receives context from act.ts, policy receives verdict + state)
- ✅ Production-ready for shipping

### Retry Effectiveness

| Tier | Cogito:14b | Frontier | Ollama | Status |
|------|-----------|----------|--------|--------|
| Verifier | 100% TP | 100% TP | 100% TP | ✅ |
| Retry (generic) | 0/5 (0%) | 4/5 (80%) | 3/5 (60%) | 🔄 |
| Improved context | Pending | Validated | Validated | 🔄 |

### Test Coverage

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| verifier.test.ts | 22 | 22 | 100% |
| retry-context.test.ts | 15 | 15 | 100% |
| integration.test.ts | 8 | 8 | 100% |

---

## Verdict Rationale

### Why IMPROVE (Not KEEP)

Verifier is production-ready; retry context needs tuning:
- ✅ Verification gate: 100% accuracy, production-ready (ship v0.10.0)
- 🔄 Retry on cogito:14b: 0% recovery with generic feedback (Phase 1.5 action)
- 🔄 Improved context design addresses FM-A1 (emit vs describe) and FM-C2 (data specificity)

### Trade-offs

- **Pro:** Verifier is production-ready; retry is model-specific improvement
- **Con:** Cogito:14b retry ineffective with generic context
- **Mitigations:** Phase 1.5 tuning with FM-specific retry signals + temperature override

---

## Phase 1.5 Improvements

### Gap 1: cogito:14b Retry Context

**Problem:** Generic retry feedback ineffective on cogito:14b (0% recovery)

**Solution:** Model-specific retry context with FM-A1 + FM-C2 signals
- FM-A1 signal: Teaches "emit answer directly" vs "describe reasoning"
- FM-C2 signal: Requires ≥3 specific data references in long-form responses
- Temperature override: 0.0 → 0.2 for exploration

**Success Criteria:** ≥50% recovery rate on cogito:14b

**Owner:** Reasoning Team

### Gap 2: Improved Context Validation

**Problem:** Improved retry context (FM-A1, FM-C2 signals) only tested on frontier/Ollama

**Solution:** Validate improved context on all tiers and promote policy if lift confirmed

**Success Criteria:** >30% lift across all tiers with improved context

**Owner:** Reasoning Team

---

## Implementation

### Key Files

- `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` — Gate logic
- `packages/reasoning/src/kernel/capabilities/verify/retry-context.ts` — Retry signals
- `packages/reasoning/tests/m3-verifier-retry.test.ts` — Validation tests

### Configuration

```typescript
// Verifier is always-on; retry is opt-in
const agent = builder.build({
  verification: {
    enabled: true, // Verifier gate
    retryPolicy: 'improvedVerifierRetryPolicy' // Opt-in improved context
  }
});
```

---

## Phase 2 & Beyond

- **Semantic Tier 2:** Embeddings-based similarity for verbose query understanding
- **Tier-adaptive retry:** Different retry contexts for qwen3, Ollama, frontier
- **Confidence scoring:** Return confidence along with retry recommendation

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-A Tool Engagement|FM-A1: No-Tool Fabrication]]
- [[Failure-Modes/FM-C Reasoning|FM-C2: Long-Form Regression]]
- [[Failure-Modes/FM-E Output|FM-E: Output Quality]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 retry tuning pending  
**Status:** 🔄 IMPROVE — Verifier ships; retry context tuning needed
