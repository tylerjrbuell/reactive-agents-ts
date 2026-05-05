---
aliases: [M6, Skill System, Learnable Capabilities]
tags: [experiment, mechanism, spike, M6]
mechanism: M6
verdict: IMPROVE
date: 2026-05-04
owner: Skills Team
---

# M6: Skill System

**Mechanism:** M6 — Learnable capabilities with activation, refinement, and conflict resolution

**Owner:** Skills Team

**Verdict:** 🔄 IMPROVE

**Evidence:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`

---

## Overview

M6 provides a framework for agent learning through reusable, refinable skills:
- **Activation** — Skills trigger on task patterns
- **Refinement** — Skills improve through experience
- **Conflict Resolution** — Handle competing skills gracefully

Mitigates [[Failure-Modes/FM-G Multi-turn|FM-G1]] (coherence loss) by enabling skill transfer across sessions.

---

## Success Criteria

- [x] Lifecycle works (activation, refinement)
- [x] Learning transfers within session
- [ ] Learning persists across sessions (Phase 1.5)
- [ ] Conflict resolution validated (Phase 1.5)

---

## Phase 1 Validation Results

### Key Findings

**From wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md:**
- ✅ Lifecycle works; skills activate and refine correctly
- ✅ Learning transfers within single session
- ❌ Learning doesn't persist across sessions (requires Phase 1.5 work)

### Test Coverage

| Aspect | Tests | Pass | Status |
|--------|-------|------|--------|
| Lifecycle (activation) | 6 | 6 | ✅ |
| Refinement | 4 | 4 | ✅ |
| Conflict resolution | 3 | 3 | ✅ |
| Persistence (mock) | 5 | 0 | ❌ |
| **Total** | **18** | **13** | **🔄** |

---

## Verdict Rationale

### Why IMPROVE (Not KEEP)

Lifecycle is production-ready; persistence needs implementation:
- ✅ Activation: Skills correctly trigger on task patterns
- ✅ Refinement: Skills improve through experience
- ❌ Persistence: Learning lost at session boundary
- ❌ Conflict: Unresolved when multiple skills match

### Trade-offs

- **Pro:** Lifecycle foundation is solid, enables learning
- **Con:** No cross-session persistence; learning resets each session
- **Mitigations:** Phase 1.5 persistence layer (SQLite/filesystem)

---

## Phase 1.5 Improvements

### Gap 1: Skill Persistence Layer

**Problem:** Learning transfers within session but doesn't persist; lost at session boundary

**Solution:** Implement SQLite or filesystem skill storage with version control

**Success Criteria:** Skills transfer across 3+ sessions with >70% recall

**Options:**
- **SQLite:** ACID transactions, queryable, portable
- **Filesystem:** Simple JSON files, git-compatible, version control

**Owner:** Skills Team

### Gap 2: Conflict Resolution

**Problem:** Lifecycle works but unresolved when multiple skills match task

**Solution:** Implement conflict resolution heuristics (priority, specificity, recency)

**Success Criteria:** Correct skill selected in 95%+ of conflicts

**Owner:** Skills Team

---

## Implementation

### Key Files

- `packages/skills/src/skill-service.ts` — Lifecycle logic
- `packages/skills/src/lifecycle.ts` — Activation, refinement
- `packages/skills/src/persistence.ts` — Storage layer (Phase 1.5)
- `packages/skills/tests/skill-system.test.ts` — Validation tests

---

## Phase 2 & Beyond

- **Skill sharing:** Share skills across agents via semantic similarity
- **Skill merging:** Combine similar skills to reduce redundancy
- **Skill pruning:** Remove ineffective skills automatically

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-G Multi-turn|FM-G1: Coherence Loss]]
- [[Decisions/Skill Lifecycle|Skill Lifecycle Decision]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 persistence pending  
**Status:** 🔄 IMPROVE — Lifecycle ships; persistence layer needed
