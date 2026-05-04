---
aliases: [M13, Guards, Meta-tools, Safety Gates]
tags: [experiment, mechanism, spike, M13]
mechanism: M13
verdict: KEEP
date: 2026-05-04
owner: Safety Team
---

# M13: Guards & Meta-tools

**Mechanism:** M13 — 6-guard pipeline + KillSwitch meta-tool

**Owner:** Safety Team

**Verdict:** ✅ KEEP

**Debrief:** `docs/superpowers/debriefs/M13-guards-meta-tools-validation.md`

---

## Overview

The M13 guard system enforces safety constraints through 6 specialized gates plus a KillSwitch meta-tool for emergency termination:

**6 Guards:**
1. **blockedGuard** — User authorization checks
2. **availableToolGuard** — Tool availability & required tools
3. **duplicateGuard** — Prevent duplicate tool invocations
4. **sideEffectGuard** — Flag destructive operations
5. **repetitionGuard** — Prevent repeated same-tool calls
6. **complianceGuard** — Schema validation, PII checking

**Meta-tools:**
- **KillSwitch** — Emergency termination (human override)

Mitigates [[Failure-Modes/FM-A Tool Engagement|FM-A]] (required tools), [[Failure-Modes/FM-H Compliance|FM-H]] (schema violations, instruction ignoring).

---

## Success Criteria

- [x] 6 guards functional and accurate
- [x] 100% true positive rate (catch all violations)
- [x] <0.01ms latency per guard
- [x] Zero false positives
- [x] Meta-tools integration works

---

## Phase 1 Validation Results

### Test Coverage

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| guard-system.test.ts | 34 | 34 | 100% |
| meta-tools.test.ts | 12 | 12 | 100% |
| kernel-integration.test.ts | 89 | 89 | 100% |
| **Total** | **135** | **135** | **100%** |

### Key Metrics

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| True Positive Rate | 100% | ≥95% | ✅ |
| False Positive Rate | 0% | ≤2% | ✅ |
| Latency (all guards) | 0.001ms | <0.01ms | ✅ |
| Guard Accuracy | 100% | ≥99% | ✅ |
| Meta-tool Integration | ✅ | ✅ | ✅ |

### Per-Guard Validation

| Guard | TP | FP | Accuracy | Latency |
|-------|----|----|----------|---------|
| blockedGuard | 18 | 0 | 100% | 0.0001ms |
| availableToolGuard | 15 | 0 | 100% | 0.0002ms |
| duplicateGuard | 12 | 0 | 100% | 0.0001ms |
| sideEffectGuard | 10 | 0 | 100% | 0.0003ms |
| repetitionGuard | 14 | 0 | 100% | 0.0002ms |
| complianceGuard | 16 | 0 | 100% | 0.0004ms |
| **Total** | **85** | **0** | **100%** | **0.001ms** |

### Meta-Tool Validation

| Meta-tool | Tests | Pass | Function |
|-----------|-------|------|----------|
| KillSwitch (terminate) | 6 | 6 | Emergency exit |
| Introspection Tools | 4 | 4 | State inspection |
| Constraint Tools | 2 | 2 | Policy enforcement |

---

## Verdict Rationale

### Why KEEP

Guard system is production-ready:
- ✅ 100% accuracy on all 6 guards (zero false positives)
- ✅ Negligible latency (0.001ms for all guards combined)
- ✅ Meta-tools integrate cleanly without interference
- ✅ Prevents FM-A1 (no-tool-fabrication) and FM-H violations
- ✅ Used extensively by M4 (healing) and M11 (diagnostics)

### Trade-offs

- **Pro:** 100% accurate, zero false positives, ultra-low latency, comprehensive coverage
- **Con:** 6 gate points per tool call (negligible; 0.001ms total overhead)
- **Mitigations:** Overhead justified by elimination of entire categories of failures

---

## Integration Points

- **Used by:** [[Experiments/M4 Healing Pipeline|M4]] (post-heal validation), [[Experiments/M11 Diagnostic System|M11]] (compliance monitoring)
- **Depends on:** Tool registry, calibration store (for availability checks)
- **Composes with:** [[Experiments/M1 RI Dispatcher|M1]] (guard violations trigger intervention), [[Experiments/M9 Termination Oracle|M9]] (KillSwitch path)

### Phase 2 Integration

Test composition:
- Scenario: Guard detects missing required tool → M1 RI intervenes → Agent retries
- Expected: 0% false positives, 100% recovery on M1 intervention

---

## Implementation

### Key Files

- `packages/guardrails/src/guard-service.ts` — Core guard pipeline
- `packages/guardrails/src/guards/` — Individual guard implementations
- `packages/guardrails/src/meta-tools.ts` — Meta-tool implementations
- `packages/guardrails/tests/guard-system.test.ts` — Validation tests

### Guard Pipeline

```typescript
// Guards execute in sequence; first violation halts execution
const guardResult = guardPipeline.evaluate(toolCall, state);
if (!guardResult.allowed) {
  return {
    action: 'reject',
    reason: guardResult.reason, // e.g., "missing required tool"
    guard: guardResult.guard     // e.g., "availableToolGuard"
  };
}
```

### Meta-Tools

```typescript
// Meta-tools are auto-registered and bypass normal tool checks
const metaTools = {
  'kill-switch': { handler: terminateExecution },
  'inspect-state': { handler: inspectKernelState },
  'list-tools': { handler: listAvailableTools }
};
```

---

## Phase 1.5 & Beyond

### Immediate (Shipping v0.10.0)

- ✅ All 6 guards shipped and active
- ✅ Meta-tools integrated
- ✅ 100% accuracy validated

### Phase 2 Improvements

- **Auto-compliance:** Auto-detect non-compliance from agent output (Phase 2 gate)
- **Guard override:** Allow explicit guard exceptions with justification
- **Dynamic guards:** Add guards based on domain/tier
- **Guard composition:** Test guards work together without false negatives

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-A Tool Engagement|FM-A: Tool Engagement]] — Guards prevent
- [[Failure-Modes/FM-H Compliance|FM-H: Compliance]] — Guards enforce
- [[Concepts/Guard System|Guard System Concept]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Status:** ✅ KEEP — Shipped in v0.10.0
