---
aliases: [M9, Termination Oracle, Single-Owner Arbitration]
tags: [experiment, mechanism, spike, M9]
mechanism: M9
verdict: KEEP
date: 2026-05-04
owner: Orchestration Team
---

# M9: Termination Oracle

**Mechanism:** M9 — Single-owner termination gateway (arbitrator pattern)

**Owner:** Orchestration Team

**Verdict:** ✅ KEEP

**Debrief:** `docs/superpowers/debriefs/M9-termination-oracle-validation.md`

---

## Overview

The Termination Oracle consolidates all loop termination logic into a single authoritative gateway. Before the fix (Stage 5 W4 / FIX-18), the kernel had **9 independent termination paths** scattered across multiple files — a root cause of failure mode [[Failure-Modes/FM-D Loop Control|FM-D]] (infinite loops, early surrender).

**Current design:** All 9 termination paths converge through 2 authorized gateways:
1. **`terminate()` helper** — Imperative terminations (sync path)
2. **`applyTermination()` via arbitrator** — Verdict-driven terminations (arbitrated path)

---

## Success Criteria

- [x] All 9 original termination paths consolidated
- [x] Single decision authority (arbitrator)
- [x] 100% path coverage enforced
- [x] Zero regressions in loop control
- [x] CI lint prevents future bypasses

---

## Phase 1 Validation Results

### Test Coverage

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| termination-oracle.test.ts | 24 | 24 | 100% |
| loop-detection.test.ts | 18 | 18 | 100% |
| arbitrator-integration.test.ts | 12 | 12 | 100% |
| **Total** | **54** | **54** | **100%** |

### Key Metrics

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Path Coverage | 100% (9/9) | 100% | ✅ |
| Regressions | 0 | 0 | ✅ |
| False Terminations | 0 | 0 | ✅ |
| Premature Terminations | 0 | 0 | ✅ |
| CI Lint Enforcement | ✅ | ✅ | ✅ |

### The 9 Termination Paths (Now Consolidated)

| Path | Trigger | Route | Result |
|------|---------|-------|--------|
| agent-final-answer (tool) | `final-answer` tool invoked | arbitrator | exit-success |
| agent-final-answer (regex) | `FINAL ANSWER:` prefix detected | arbitrator | exit-success |
| agent-final-answer (end-turn) | LLM returns `end_turn` | arbitrator | exit-success |
| fast-path-completed | Task is trivial (no tools) | arbitrator | exit-success |
| loop-detected | Repetition or all-tools-called | arbitrator | exit-success (or veto) |
| controller-early-stop | RI dispatcher signals early stop | arbitrator | exit-success (or veto) |
| oracle-decision | Legacy evaluator chain decides | arbitrator | forward verdict |
| max-iterations | Budget exhausted | arbitrator | exit-failure |
| kernel-error | Unrecoverable error | arbitrator | exit-failure |

---

## Verdict Rationale

### Why KEEP

The arbitrator pattern solves the core problem:
- **Single authority:** No competing termination paths
- **Auditable logic:** All termination decisions routed through one function
- **Testable:** 100% path coverage, zero regressions
- **Enforceable:** CI lint prevents new backdoor termination paths
- **Composable:** Arbitrator can veto terminations (e.g., guard override)

### Trade-offs

- **Pro:** Clear authority, auditable, prevents FM-D (loops), testable
- **Con:** All terminations converge through one function (potential bottleneck)
- **Mitigations:** Arbitrator is lightweight (~100 LOC); no observed latency impact

---

## Integration Points

- **Used by:** [[Experiments/M1 RI Dispatcher|M1 RI]] (early-stop), [[Experiments/M3 Verifier and Retry|M3 verifier]] (halt on unrecoverable)
- **Depends on:** Loop detector, max-iterations counter
- **Composes with:** [[Experiments/M11 Diagnostic System|M11 diagnostics]] (classify termination type)

### Phase 2 Integration

- Single arbitrator must be the **only termination path** for all kernel phases
- Ensure ToT outer loop honors arbitrator signal (Phase 2 work)
- Validate termination doesn't bypass guards or compliance checks

---

## Implementation

### Key Files

- `packages/reasoning/src/kernel/loop/terminate.ts` — Single-owner helper
- `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` — Decision logic
- `packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts` — Loop detection
- `packages/reasoning/tests/termination-oracle.test.ts` — Validation tests

### Architecture

```typescript
// All termination paths create a TerminationIntent
// Then route through arbitrator
const intent = createTerminationIntent({ kind: "agent-final-answer", ... });
const decision = arbitrator.arbitrate(intent, state);
applyTermination(decision, state);
```

---

## Phase 1.5 & Beyond

### Immediate (Shipping v0.10.0)

- ✅ Single arbitrator active
- ✅ All 9 paths consolidated
- ✅ CI lint enforces no bypasses

### Phase 2 Improvements

- **ToT outer loop:** Wire arbitrator signal to tree-of-thought coordinator
- **Guard integration:** Arbitrator respects guard veto (prevents policy violations)
- **Termination telemetry:** Diagnostic system classifies why loop terminated

---

## References

- [[MOCs/Research MOC|Research MOC]] — All Phase 1 mechanism validation
- [[Failure-Modes/FM-D Loop Control|FM-D: Loop Control]] — What this mechanism mitigates
- [[Decisions/Single-Owner Arbitration|Single-Owner Arbitration Decision]]
- [[MOCs/Architecture MOC|Architecture MOC]] — Kernel architecture

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Status:** ✅ KEEP — Shipped in v0.10.0
