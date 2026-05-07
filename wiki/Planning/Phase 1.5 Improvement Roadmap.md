---
aliases: [Phase 1.5, Improvement Roadmap, Next Steps]
tags: [planning, phase-gate, roadmap]
date: 2026-05-04
status: SUPERSEDED
superseded_by: wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md v4.0 §6 Phase 1.5
owner: Architecture Team
phase: Phase 1.5
---

> ⚠️ **SUPERSEDED — 2026-05-07.** Per-mechanism detail (M3/M6/M7/M8/M10 scopes, file paths, effort estimates) is retained here as reference. Phase sequencing and gates now live in `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v4.0 §6 Phase 1.5.

# Phase 1.5: Improvement Roadmap

**Timeline:** May-June 2026

**Goal:** Implement concrete improvements to 5 IMPROVE mechanisms (M3, M6, M7, M8, M10) while establishing wiki as primary documentation source.

---

## Phase 1.5 Mechanisms (5 IMPROVE → KEEP)

All 5 mechanisms have clear validation gaps and Phase 1.5 action items identified.

### M3: Verifier & Retry — cogito:14b Tuning

**Gap:** Generic retry context ineffective on cogito:14b (0% recovery)

**Action:** Tune retry prompts for FM-A1 (no-tool-fabrication) and FM-C2 (long-form regression)

**Key Changes:**
- FM-A1 signal: "emit answer directly" vs "describe reasoning"
- FM-C2 signal: Require ≥3 specific data references
- Temperature override: 0.0 → 0.2 for exploration

**Success Criteria:** ≥50% recovery on cogito:14b with tuned context

**Owner:** Reasoning Team

**Files to Update:**
- `packages/reasoning/src/kernel/capabilities/verify/retry-context.ts`
- `packages/reasoning/tests/m3-verifier-retry.test.ts`

**Effort:** 3-5 days

**Evidence:** `.agents/MEMORY.md` M3 spike validation

---

### M6: Skill System — SQLite Persistence

**Gap:** Learning transfers within session but doesn't persist; lost at session boundary

**Action:** Implement skill persistence layer (SQLite or filesystem)

**Key Changes:**
- SQLite schema for skill storage (version control)
- Skill lifecycle: activation → refinement → persistence
- Conflict resolution heuristics (priority, specificity, recency)

**Success Criteria:** Skills transfer across 3+ sessions with >70% recall

**Owner:** Skills Team

**Options:**
1. **SQLite** (recommended) — ACID transactions, queryable, portable
2. **Filesystem** — Simple JSON files, git-compatible

**Files to Create/Update:**
- `packages/skills/src/persistence.ts` (NEW)
- `packages/skills/src/skill-service.ts` (update to use persistence)
- `packages/skills/tests/skill-persistence.test.ts` (NEW)

**Effort:** 5-7 days

---

### M7: Calibration — 8+ Field Activation

**Gap:** 14 fields defined; only 3 active consumers; need 5+ more

**Action:** Wire calibration data to cost router, strategy selector, provider adapter, memory system, RI dispatcher

**Key Changes:**
- Cost Router: Use `tokenEfficiency` for model selection
- Strategy Selector: Use `reasoningDepth`, `parallelization`
- Provider Adapter: Use `thinkingMode`, `toolCallingFidelity`
- Memory System: Use `memoryUsage` for context window sizing
- RI Dispatcher: Use `consistencyBias`, `creativityBias`

**Success Criteria:** ≥8 fields actively influencing decisions with measurable lift

**Owner:** Calibration Team

**Files to Update:**
- `packages/cost/src/complexity-router.ts`
- `packages/reasoning/src/strategies/strategy-evaluator.ts`
- `packages/llm-provider/src/abstract-provider.ts`
- `packages/memory/src/memory-service.ts`
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`

**Effort:** 4-6 days

---

### M8: Sub-agent Delegation — Real LLM Metrics

**Gap:** Test harness ready (10 scenarios); real LLM behavior unvalidated

**Action:** Full execution with frontier + qwen3:14b models to measure accuracy lift and token ROI

**Key Changes:**
- Run all 10 delegation scenarios with real LLMs
- Measure accuracy lift (target: ≥15% on complex tasks)
- Measure token savings (target: ≥15% on complex tasks)
- Validate error containment on real LLMs

**Success Criteria:** Confirm accuracy ≥15% lift on complex (≥3 step) tasks

**Owner:** Orchestration Team

**Test Scenarios:**
- S1-S10: Various complexity levels (simple to hard)
- Measure: accuracy, token cost, latency, error containment

**Files to Update:**
- `packages/a2a/tests/m8-sub-agent-delegation.test.ts` (add real LLM runs)
- `docs/superpowers/debriefs/M8-sub-agent-delegation-validation.md` (update results)

**Effort:** 3-5 days (mostly execution and analysis)

---

### M10: Memory System — Multi-Session Validation

**Gap:** Only tested single-session; multi-session scenarios unvalidated

**Action:** Design realistic multi-session scenarios with session breaks and context injection

**Key Changes:**
- Episodic memory compression validation across session breaks
- Recall accuracy on multi-turn conversations (target: >80%)
- Memory pollution prevention (task-scoped isolation)
- Tier 2 semantic search for verbose queries (target: >80% recall)

**Success Criteria:** >80% recall on natural multi-turn conversations across 3+ sessions

**Owner:** Memory Team

**Scenarios to Validate:**
1. Long conversation (20+ turns) → compression → session break → new session references prior context
2. Multi-session with no context injection → memory isolated per task
3. Verbose query ("how did we fix the healing pipeline?") → Tier 2 semantic search

**Files to Create/Update:**
- `packages/memory/tests/multi-session-memory.test.ts` (NEW)
- `packages/memory/src/layers/semantic-memory.ts` (add Tier 2 embeddings)
- `docs/superpowers/debriefs/M10-memory-system-validation.md` (update results)

**Effort:** 4-6 days

---

## Documentation Consolidation (Parallel)

**Goal:** Establish wiki as primary documentation source; deprecate spec docs.

### Phase 1.5 Doc Work

- [ ] Link all debriefs from mechanism notes (M1-M3, M5-M7 pending)
- [ ] Create `wiki/Planning/` folder for roadmaps
- [ ] Create `wiki/Team/` folder for conventions
- [ ] Create `wiki/Releases/` folder for version history
- [ ] Add frontmatter to spec docs: "See wiki/ for current state"
- [ ] Update DOCUMENT_INDEX.md with wiki references
- [ ] All new PR descriptions reference wiki docs

**Effort:** 2-3 days (parallel with mechanism work)

---

## Success Criteria for Phase 1.5

### Mechanism Improvements

| Mechanism | Target | Success Criteria |
|-----------|--------|------------------|
| M3 | ≥50% cogito:14b recovery | Retry context tuned; validated on cogito:14b |
| M6 | >70% cross-session recall | Persistence layer implemented and tested |
| M7 | ≥8 active consumers | 5+ consumers wired with measurable lift |
| M8 | ≥15% accuracy lift (complex) | Real LLM metrics validated |
| M10 | >80% multi-session recall | Scenarios validated; Tier 2 search added |

### Documentation

- ✅ Wiki established as primary (phase gate: team default to wiki)
- ✅ Spec docs deprecated (frontmatter notes wiki location)
- ✅ All debriefs linked from wiki
- ✅ All decisions documented in wiki

---

## Timeline & Owners

### Week 1 (May 6-10)
- M3: Retry context tuning begins (Reasoning)
- M10: Multi-session scenarios designed (Memory)
- Docs: Link debriefs, update DOCUMENT_INDEX (Documentation)

### Week 2-3 (May 13-24)
- M6: SQLite persistence implementation (Skills)
- M7: Calibration consumer wiring (Calibration)
- M8: Real LLM execution setup (Orchestration)

### Week 4 (May 27-31)
- M3: cogito:14b validation (Reasoning)
- M6: Cross-session testing (Skills)
- M7: Lift validation (Calibration)
- M8: Results analysis (Orchestration)
- M10: Multi-session testing (Memory)

### Week 5 (June 3-7)
- All mechanisms: Results consolidation
- Docs: Mark spec docs as deprecated
- Decision: Readiness for Phase 2

---

## Phase Gate: Phase 1.5 Completion

**To advance to Phase 2, ALL of the following must be true:**

1. ✅ M3 achieves ≥50% recovery on cogito:14b
2. ✅ M6 skill persistence implemented and tested
3. ✅ M7 has ≥8 active field consumers with metrics
4. ✅ M8 real LLM metrics show ≥15% accuracy lift (complex tasks)
5. ✅ M10 multi-session memory validated (>80% recall)
6. ✅ Wiki is primary documentation (all new decisions in wiki only)
7. ✅ All Phase 1.5 results documented in wiki (debrief updates)

---

## Phase 2 Preparation

Once Phase 1.5 complete:
- All 13 mechanisms either KEEP (ship v0.10.0) or IMPROVE (Phase 1.5 done)
- Wiki fully populated with current state
- Spec docs deprecated (readonly reference)
- Team aligned on architecture for orchestration decomposition

**Phase 2 Gate:** Orchestration decomposition (split builder.ts + execution-engine.ts)

---

## References

- [[Experiments/M3 Verifier and Retry|M3 Verifier & Retry]] — Retry tuning details
- [[Experiments/M6 Skill System|M6 Skill System]] — Persistence gap
- [[Experiments/M7 Calibration|M7 Calibration]] — Field activation
- [[Experiments/M8 Sub-agent Delegation|M8 Sub-agent Delegation]] — Real LLM metrics
- [[Experiments/M10 Memory System|M10 Memory System]] — Multi-session validation
- [[Decisions/Documentation Consolidation Roadmap|Doc Consolidation Roadmap]] — Wiki strategy

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1.5 (Ready to start)  
**Effort:** ~25-30 days across team (parallel work)  
**Target Completion:** June 7, 2026
