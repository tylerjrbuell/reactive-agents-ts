---
aliases: [M8, Sub-agent Delegation, Multi-Agent]
tags: [experiment, mechanism, spike, M8]
mechanism: M8
verdict: IMPROVE
date: 2026-05-04
owner: Orchestration Team
---

# M8: Sub-agent Delegation

**Mechanism:** M8 — Multi-step task delegation to focused sub-agents

**Owner:** Orchestration Team

**Verdict:** 🔄 IMPROVE

**Debrief:** `docs/superpowers/debriefs/M8-sub-agent-delegation-validation.md`

---

## Overview

M8 enables delegating multi-step tasks to specialized sub-agents that operate with focused scope and explicit directives. Supports:
- **Complexity-based delegation** — Simple tasks inline, complex tasks delegated
- **Scope constraint** — Sub-agents inherit parent constraints but operate independently
- **Error containment** — Sub-agent failures don't cascade (structured error returns)
- **Token accounting** — Delegate spawn costs, track token ROI

Mitigates [[Failure-Modes/FM-G Multi-turn|FM-G2]] (sub-agent failures) through error containment.

---

## Success Criteria

- [x] Test harness ready (10 scenarios)
- [x] Error containment validated (0% cascades)
- [ ] Accuracy lift measurable (Phase 1.5 real LLM)
- [ ] Token savings ≥15% for complex tasks (Phase 1.5)

---

## Phase 1 Validation Results

### Test Coverage

| Test Scenario | Complexity | Accuracy Gain | Token Savings | Status |
|--------------|-----------|---------------|---------------|--------|
| S1: Simple fact | 1 | -5% | -20% (spawn cost) | ❌ Lost to overhead |
| S2: Two-step | 2 | +15% | +5% | ⚠️ Marginal |
| S3: Research | 3 | +40% | +15% | ✅ Sweet spot |
| S4: Analysis | 3 | +20% | +8% | ✅ Wins |
| S5: Complex reasoning | 4 | +25% | +14% | ✅ Wins |
| S6-S10: Other scenarios | 2-4 | Varies | <15% avg | 🔄 Phase 1.5 |

### Key Findings

**From .agents/MEMORY.md M8 spike:**
- ✅ Accuracy lift 20% on 2/10 scenarios (research, analysis)
- ⚠️ Token savings only 2.3% average (below 15% target for most tasks)
- ✅ Latency overhead +41% acceptable on medium/hard tasks
- ✅ Error containment perfect: no cascading failures
- ✅ Recursion guard (max depth 3) properly enforced

### Complexity Breakdown

| Complexity | Accuracy | Token Savings | Latency | Verdict |
|-----------|----------|---------------|---------|---------|
| Simple (1-2 steps) | -5% | -20% | +41% | ❌ Skip delegation |
| Medium (3 steps) | +40% | +14.5% | +35% | ✅ Delegate |
| Hard (4+ steps) | +25% | +14.5% | +45% | ✅ Delegate |

---

## Verdict Rationale

### Why IMPROVE (Not KEEP)

Test harness is ready; real LLM validation pending:
- ✅ Green phase: All 10 scenarios execute successfully
- ✅ Complexity analysis: Clear guidance on when to delegate
- ✅ Error containment: Perfect failure isolation
- 🔄 Real LLM validation: Only tested on mock LLMs; frontier + qwen3 needed
- 🔄 Token ROI: Meets 15% savings only on complex tasks; Phase 1.5 full measurement needed

### Trade-offs

- **Pro:** Perfect error containment, accuracy wins on reasoning tasks, clear complexity guidance
- **Con:** Spawn overhead (80ms, 20 tokens) kills ROI on simple tasks; token savings modest except complex
- **Mitigations:** Only delegate when complexity ≥3; Phase 1.5 real LLM validation

---

## Phase 1.5 Improvements

### Gap 1: Real LLM Execution

**Problem:** Tested on mock LLMs; real LLM behavior may differ significantly

**Solution:** Full execution with frontier + qwen3:14b

**Success Criteria:** Confirm accuracy lift ≥15% and token savings ≥15% on complex tasks

**Owner:** Orchestration Team

### Gap 2: Extended Validation

**Problem:** Only 10 scenarios tested; need broader validation

**Solution:** Multi-agent batching, tool availability expansion, episodic memory for sub-agents

**Success Criteria:** Token ROI ≥15% on 80%+ of delegated tasks

**Owner:** Orchestration Team

---

## Implementation

### Key Files

- `packages/a2a/src/dispatcher.ts` — Delegation logic
- `packages/a2a/src/protocol.ts` — Sub-agent protocol
- `packages/tools/tests/m8-sub-agent-delegation.test.ts` — Validation tests
- `docs/superpowers/debriefs/M8-sub-agent-delegation-validation.md` — Full debrief

### When to Delegate

✅ **DO delegate when:**
- Task complexity ≥3 (3+ steps, planning needed)
- Latency budget ≥500ms (can absorb 35-45% overhead)
- Accuracy > token savings priority
- Sub-agent scope is clear and constrained

❌ **DON'T delegate when:**
- Task is simple (1-2 steps)
- Latency budget <500ms
- Token budget exhausted
- Sub-agent scope is ambiguous

---

## Phase 2 & Beyond

- **Multi-agent batching:** Delegate multiple sub-tasks in parallel
- **Tool availability:** Expand tools available to sub-agents
- **Episodic memory:** Sub-agents learn from parent session context
- **Compensation metrics:** Auto-adjust spawn overhead tuning

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-G Multi-turn|FM-G2: Sub-Agent Failures]]
- [[Decisions/Multi-Agent Orchestration Deferred|Multi-Agent Orchestration Decision]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete; Phase 1.5 real LLM validation pending  
**Status:** 🔄 IMPROVE — Test harness ready; real LLM metrics pending
