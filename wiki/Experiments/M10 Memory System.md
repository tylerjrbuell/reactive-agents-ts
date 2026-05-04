---
aliases: [M10, Memory System, 4-Layer Memory]
tags: [experiment, mechanism, spike, M10]
mechanism: M10
verdict: IMPROVE
date: 2026-05-04
owner: Memory Team
---

# M10: Memory System

**Mechanism:** M10 — 4-layer memory system (Working/Semantic/Episodic/Procedural)

**Owner:** Memory Team

**Verdict:** 🔄 IMPROVE

**Debrief:** `docs/superpowers/debriefs/M10-memory-system-validation.md`

---

## Overview

The M10 memory system provides persistent cross-session context through 4 specialized layers:
- **Working Memory** — Current context window (task-specific)
- **Semantic Memory** — Facts and knowledge (persistent FTS5 search)
- **Episodic Memory** — Experience logs (with compression via stash)
- **Procedural Memory** — Learned skills (activation, refinement)

Mitigates [[Failure-Modes/FM-F Context and Memory|FM-F]] (context overflow, memory pollution) by enabling task-scoped queries and episodic compression.

---

## Success Criteria

- [x] Store and recall across sessions
- [x] Prevent false memory injection (task-scoped queries)
- [x] >60% recall accuracy on natural language queries
- [x] <5ms lookup latency
- [ ] >80% recall on multi-session scenarios (Phase 1.5)

---

## Phase 1 Validation Results

### Test Coverage

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| memory-system.test.ts | 16 | 16 | 100% |
| semantic-search.test.ts | 12 | 12 | 100% |
| episodic-memory.test.ts | 10 | 10 | 100% |
| **Total** | **38** | **38** | **100%** |

### Key Metrics

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Recall Accuracy (keyed) | 100% | 100% | ✅ |
| Recall Accuracy (verbose) | 66.7% | >60% | ✅ |
| Accuracy Lift vs No Memory | +66.7pp | >50pp | ✅ |
| Query Latency | 0.05ms | <5ms | ✅ |
| Memory Overhead | 4KB/100 entries | <10KB | ✅ |
| FM-F2 Mitigation | Task-scoped | Yes | ✅ |

### Recall by Query Type

| Query Type | Accuracy | Notes |
|------------|----------|-------|
| Key-term (e.g., "healing pipeline") | 100% | FTS5 exact match |
| Verbose (natural language) | 66.7% | Requires decomposition |
| Semantic (embeddings) | Pending | Phase 1.5 Tier 2 |

### Memory Composition

| Layer | Purpose | Validation | Status |
|-------|---------|-----------|--------|
| Working | Current context | ✅ Task isolation | ✅ |
| Semantic | Facts & knowledge | ✅ FTS5 search | ✅ |
| Episodic | Experience logs | ✅ Compression via stash | 🔄 |
| Procedural | Learned skills | ✅ Lifecycle | 🔄 |

---

## Verdict Rationale

### Why IMPROVE (Not KEEP)

Core mechanism is validated:
- ✅ Store+recall works reliably
- ✅ Task-scoped queries prevent false injection (FM-F2 mitigated)
- ✅ FTS5 search production-ready

Gaps requiring Phase 1.5 work:
- ❌ Verbose query recall only 66.7% (needs semantic Tier 2)
- ❌ Multi-session scenarios unvalidated (only single-session tested)
- ❌ Episodic memory compression needs realistic scenarios

### Trade-offs

- **Pro:** Reliable storage, task-scoped safety, low overhead
- **Con:** Verbose recall sub-optimal; multi-session untested
- **Mitigations:** Phase 1.5 to add semantic search, validate multi-session

---

## Phase 1.5 Improvements

### Gap 1: Verbose Query Recall (66.7%)

**Problem:** FTS5 keyword search fails on natural language ("how did we fix the healing pipeline?")

**Solution:** Implement Tier 2 semantic search via embeddings + similarity

**Success Criteria:** >80% recall on natural language queries

**Owner:** Memory Team

### Gap 2: Multi-Session Memory

**Problem:** Episodic memory only validated within single session

**Solution:** Design realistic multi-turn scenarios with session breaks and context injection

**Success Criteria:** >80% recall across 3+ session breaks

**Owner:** Memory Team

---

## Integration Points

- **Used by:** [[Experiments/M5 Context Curation|M5]] (episodic stash), [[Experiments/M6 Skill System|M6]] (procedural layer)
- **Depends on:** FTS5 (search), SQLite (persistence)
- **Composes with:** [[Experiments/M1 RI Dispatcher|M1]] (intervention based on memory gaps)

---

## Implementation

### Key Files

- `packages/memory/src/memory-service.ts` — Core 4-layer system
- `packages/memory/src/layers/` — Individual layer implementations
- `packages/memory/src/persistence.ts` — SQLite storage
- `packages/memory/tests/memory-system.test.ts` — Validation tests

### Configuration

```typescript
// Memory is auto-enabled; task-scoped by default
const memory = memoryService.create({
  scope: "task", // Prevents cross-task pollution
  retention: "session", // Episodic memory lifetime
  search: { tier: 1 } // FTS5 only; Tier 2 (semantic) Phase 1.5
});
```

---

## Phase 2 & Beyond

- **Tier 2 Semantic Search:** Embeddings for verbose query understanding
- **Multi-agent Memory:** Shared semantic layer across delegated agents
- **Adaptive Retention:** Forget stale episodic memory after N sessions
- **Compression:** Auto-compress episodic logs via summarization

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-F Context and Memory|FM-F: Context & Memory]] — What this mitigates
- [[Decisions/4-Layer Memory|4-Layer Memory Design]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 improvement pending  
**Status:** 🔄 IMPROVE — Shipped with gaps for Phase 1.5
