---
aliases: [Research & Validation]
tags: [MOC]
---

# Research MOC

**Purpose:** Comprehensive spike research, mechanism validation, failure modes, and improvement loop tracking.

---

## Phase 1 Mechanism Validation (Complete ✅)

### Overview
- [[Experiments/Phase 1 Mechanism Validation|Phase 1 Results]] — All 13 mechanisms validated via TDD
- **8 KEEP verdicts** — M1, M2, M4, M5, M9, M11, M12, M13
- **5 IMPROVE verdicts** — M3, M6, M7, M8, M10
- **Evidence:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`

### KEEP Mechanisms
- [[Experiments/M1 RI Dispatcher|M1 RI Dispatcher]] — ✅ KEEP | All 6 handlers wired; architecture sound; entropy-driven intervention
- [[Experiments/M2 Strategy Switching|M2 Strategy Switching]] — ✅ KEEP | 20 passing tests; switching heuristics validated; real LLM Phase 1.5
- [[Experiments/M4 Healing Pipeline|M4 Healing Pipeline]] — ✅ KEEP | 86.7% recovery, +80pp accuracy, 10:1 token ROI, 27/27 tests pass
- [[Experiments/M5 Context Curation|M5 Context Curation]] — ✅ KEEP | 60.7% compression, 38.6% token savings, 3-stage coordinated
- [[Experiments/M9 Termination Oracle|M9 Termination Oracle]] — ✅ KEEP | All 9 paths consolidated, 100% path coverage enforced, single arbitrator
- [[Experiments/M11 Diagnostic System|M11 Diagnostic System]] — ✅ KEEP | 100% TP, 0% FP, 0.02ms latency; production-ready
- [[Experiments/M12 Provider Adapters|M12 Provider Adapters]] — ✅ KEEP | All 7 hooks wired, 254/254 tests pass, zero interference
- [[Experiments/M13 Guards and Meta-tools|M13 Guards and Meta-tools]] — ✅ KEEP | 6 guards, 100% accuracy, 0.001ms latency, KillSwitch meta-tool

### IMPROVE Mechanisms
- [[Experiments/M3 Verifier and Retry|M3 Verifier & Retry]] — 🔄 IMPROVE | Verifier 100% TP; retry context needs cogito:14b tuning
- [[Experiments/M6 Skill System|M6 Skill System]] — 🔄 IMPROVE | Lifecycle works within-session; persistence layer needed for cross-session
- [[Experiments/M7 Calibration|M7 Calibration]] — 🔄 IMPROVE | 14 fields defined; only 3 active consumers; need 5+ more
- [[Experiments/M8 Sub-agent Delegation|M8 Sub-agent Delegation]] — 🔄 IMPROVE | Test harness ready (10 scenarios); real LLM metrics pending
- [[Experiments/M10 Memory System|M10 Memory System]] — 🔄 IMPROVE | Store+recall 66.7% verbose/100% keyed; multi-session scenarios pending

---

## Failure Mode Research

### Failure Mode Catalog
- [[Failure-Modes/00 FM Catalog|FM Catalog]] — 8 categories (A-H), empirical evidence, mitigations
- [[Failure-Modes/FM-A Tool Engagement|FM-A: Tool Engagement]] — FM-A1 (no-tool fabrication), FM-A2 (persistent FC failure)
- [[Failure-Modes/FM-B Tool Errors|FM-B: Tool Error Handling]] — FM-B1 (unrecoverable errors), FM-B2 (cascade failures)
- [[Failure-Modes/FM-C Reasoning|FM-C: Reasoning Quality]] — FM-C1 (red-herring reasoning), FM-C2 (long-form regression)
- [[Failure-Modes/FM-D Loop Control|FM-D: Loop Control]] — FM-D1 (infinite loops), FM-D2 (early surrender)
- [[Failure-Modes/FM-E Output|FM-E: Output Quality]] — FM-E1 (empty content), FM-E2 (fabricated specifics)
- [[Failure-Modes/FM-F Context & Memory|FM-F: Context/Memory]] — FM-F1 (context overflow), FM-F2 (memory pollution)
- [[Failure-Modes/FM-G Multi-turn|FM-G: Multi-turn]] — FM-G1 (coherence loss), FM-G2 (sub-agent failures)
- [[Failure-Modes/FM-H Compliance|FM-H: Compliance]] — FM-H1 (schema violations), FM-H2 (instruction ignoring)

### Evidence Base
- [[Failure-Modes/Empirical Evidence|Empirical Evidence]] — Failure corpus baseline, spike results, confidence levels
- [[Failure-Modes/Mitigation Strategy Matrix|Mitigation Matrix]] — Which mechanisms address which FMs

---

## Improvement Loop

### Research Methodology
- [[Concepts/Research Discipline|Research Discipline]] — 12 rules for any harness change (spike validation, hypothesis-first, frozen judge, scope of claims)
- [[Concepts/Improvement Pipeline|Improvement Pipeline]] — DISCOVERY → CATALOG → PRIORITIZE → DISSECT → DESIGN → INTEGRATE+VALIDATE → DEPRECATE
- [[Concepts/TDD Spike Pattern|TDD Spike Pattern]] — RED → GREEN → ANALYSIS methodology

### Active Spike Research (Phase 1.5)

#### Retry Context Tuning (M3)
- **Goal:** Tune retry prompts/temperature for cogito:14b
- **Evidence Gap:** M3 core validated, but retry doesn't recover on cogito
- **Success Criteria:** >50% recovery rate on cogito:14b with tuned context
- **Owner:** Reasoning team

#### Skill Persistence (M6)
- **Goal:** Implement SQLite/filesystem skill persistence across sessions
- **Evidence Gap:** Lifecycle works, but learning doesn't persist
- **Success Criteria:** Skills transfer across 3+ sessions with >70% recall
- **Owner:** Skills team

#### Calibration Activation (M7)
- **Goal:** Activate ≥8 fields with real consumers
- **Evidence Gap:** 14 fields defined, only 3 used
- **Success Criteria:** 8+ fields actively influencing decisions with metrics proving lift
- **Owner:** Calibration team

#### Sub-agent Metrics (M8)
- **Goal:** Full execution to measure accuracy lift, token cost, latency
- **Evidence Gap:** Test harness ready, effectiveness unproven
- **Success Criteria:** Quantified accuracy lift + token ROI vs. single-agent baseline
- **Owner:** Orchestration team

#### Multi-session Memory (M10)
- **Goal:** Design realistic multi-session scenarios and validation
- **Evidence Gap:** Store+recall works; episodic recall 66.7% verbose/100% keyed
- **Success Criteria:** >80% recall on natural multi-turn conversations
- **Owner:** Memory team

---

## Phase 2 Research Direction

### Integration Testing
- **Goal:** Test mechanisms in composition (healing+guards, strategy-switching+RI, etc.)
- **Rationale:** Phase 1 tested in isolation; composition may have emergent failures
- **Scope:** M2+M13, M4+M13, M3+M8 pairs

### Real LLM Validation
- **Goal:** Re-run M2, M8, M10 with frontier + local models
- **Rationale:** Phase 1 used mock LLMs; real LLM behavior may differ
- **Scope:** Claude 3.5 Sonnet, GPT-4o, Gemini 2.5, qwen3:14b

### Performance Optimization
- **Goal:** Quantify cost-benefit of mechanisms at different scales
- **Rationale:** Mechanism overhead may vary with token budget
- **Scope:** 1K, 10K, 100K token budgets

---

## Knowledge Base

### Spike Result Archives
- All 13 spike debriefs in `docs/superpowers/debriefs/M*-*-validation.md`
- Full evidence in `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`
- Detailed specs in `docs/superpowers/specs/`

### Learning Log
- [[Experiments/Phase 1 Learnings|Phase 1 Learnings]] — Improvement-first posture, TDD discipline, ownership alignment
- [[Issues/Running Issues Log|Running Issues Log]] — Active blockers, known problems, resolutions

---

**See also:** [[MOCs/Architecture MOC|Architecture MOC]] (system design), [[MOCs/Concepts MOC|Concepts MOC]] (patterns), [[MOCs/Decisions MOC|Decisions MOC]] (trade-offs)
