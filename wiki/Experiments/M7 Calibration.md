---
aliases: [M7, Calibration, Model-Specific Tuning]
tags: [experiment, mechanism, spike, M7]
mechanism: M7
verdict: IMPROVE
date: 2026-05-04
owner: Calibration Team
---

# M7: Calibration

**Mechanism:** M7 — Model-specific behavior profiling (14 fields defined)

**Owner:** Calibration Team

**Verdict:** 🔄 IMPROVE

**Evidence:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`

---

## Overview

M7 defines model-specific behavior profiles with 14 tunable fields:
- **Instruction Following** — Per-model instruction clarity
- **Thinking Preference** — When extended thinking helps
- **Tool Calling Fidelity** — Native FC vs text parsing
- **Retry Tolerance** — Recovery from errors
- **Token Efficiency** — Cost per unit output
- **And 9 others...**

Mitigates [[Failure-Modes/FM-C Reasoning|FM-C]] (reasoning quality), [[Failure-Modes/FM-A Tool Engagement|FM-A]] (tool calling) through model-aware tuning.

---

## Success Criteria

- [x] 14 fields defined and typed
- [ ] ≥8 fields actively used by consumers (Phase 1.5)
- [ ] Demonstrable accuracy lift from tuning (Phase 1.5)

---

## Phase 1 Validation Results

### Calibration Profile Status

**From wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md:**
- ✅ 14 fields defined with type safety
- ❌ Only 3 active consumers (M2, M3, M13)
- ❌ No empirical lift data (awaiting Phase 1.5 activation)

### Defined Fields

| Field | Purpose | Consumer | Status |
|-------|---------|----------|--------|
| instructionFollowing | Clarity needed | M2 (strategy) | ✅ Used |
| thinkingMode | Extended thinking | M2 (strategy) | ✅ Used |
| toolCallingFidelity | Native vs text | M12 (provider) | ✅ Used |
| retryTolerance | Error recovery | M3 (verifier) | ✅ Used |
| tokenEfficiency | Cost awareness | Pending | ❌ Unused |
| reasoningDepth | Complexity handling | Pending | ❌ Unused |
| memoryUsage | Context retention | Pending | ❌ Unused |
| parallelization | Multi-task capability | Pending | ❌ Unused |
| consistencyBias | Preference for consistency | Pending | ❌ Unused |
| creativityBias | Preference for novelty | Pending | ❌ Unused |
| **... 4 more** | ... | Pending | ❌ Unused |

---

## Verdict Rationale

### Why IMPROVE (Not KEEP)

Framework is defined; consumers need activation:
- ✅ 14 fields properly typed and validated
- ✅ 3 consumers successfully using calibration data
- ❌ 11 fields unused (10+ consumers needed)
- ❌ No empirical accuracy lift data yet

### Trade-offs

- **Pro:** Framework is comprehensive and extensible
- **Con:** High activation burden; 11 unused fields
- **Mitigations:** Phase 1.5 to activate ≥8 fields with real consumers

---

## Phase 1.5 Improvements

### Gap 1: Activate ≥8 Fields with Real Consumers

**Problem:** 14 fields defined; only 3 used. Need 5+ more active consumers.

**Solution:** Wire calibration data to cost router, strategy selector, provider adapter

**Action Items:**
1. **Cost Router** — Use `tokenEfficiency` field to route complex tasks to efficient models
2. **Strategy Selector** — Use `reasoningDepth`, `parallelization` for strategy selection
3. **Provider Adapter** — Use `thinkingMode`, `toolCallingFidelity` for hook selection
4. **Memory System** — Use `memoryUsage` for context window sizing
5. **RI Dispatcher** — Use `consistencyBias`, `creativityBias` for intervention heuristics

**Success Criteria:** ≥8 fields actively influencing decisions with measurable accuracy lift

**Owner:** Calibration Team

---

## Implementation

### Key Files

- `packages/calibration/src/calibration-service.ts` — Core service
- `packages/calibration/src/profiles/` — Per-model profiles
- `packages/calibration/src/persistence.ts` — SQLite storage
- `packages/calibration/tests/calibration.test.ts` — Validation tests

### Profile Structure

```typescript
interface CalibrationProfile {
  modelId: string;
  instructionFollowing: 'high' | 'medium' | 'low';
  thinkingMode: 'always' | 'optional' | 'never';
  toolCallingFidelity: 'native' | 'text-parse' | 'hybrid';
  retryTolerance: number; // 0-1, how many retries
  tokenEfficiency: number; // tokens per unit output
  // ... 9 more fields
}
```

---

## Phase 2 & Beyond

- **Auto-profiling:** Measure model behavior dynamically and auto-update profiles
- **Per-task calibration:** Different calibrations for different task types
- **Ensemble calibration:** Select best model for each task phase

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-C Reasoning|FM-C: Reasoning Quality]]
- [[Decisions/Calibration Persistence|Calibration Persistence Decision]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 activation pending  
**Status:** 🔄 IMPROVE — Framework defined; 5+ consumers needed
