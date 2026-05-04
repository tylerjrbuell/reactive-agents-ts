---
aliases: [Failure Mode Taxonomy]
tags: [failure-modes, empirical, catalog]
---

# Failure Mode Catalog

**Purpose:** Comprehensive taxonomy of observed LLM agent failure modes with empirical evidence, manifestations, reproduction strategies, and mitigations.

**Scope:** Phase 1 evidence from 50+ runs across 4 models (cogito:14b, qwen3:14b, claude-sonnet-4-6, gpt-4o)

---

## Failure Mode Categories (FM-A through FM-H)

### FM-A: Tool Engagement Failures

**Definition:** Agent fails to invoke required tools or invokes tools incorrectly.

**Categories:**
- [[Failure-Modes/FM-A Tool Engagement|FM-A1 No-Tool Fabrication]] — Agent writes answer directly instead of using required tools
- [[Failure-Modes/FM-A Tool Engagement|FM-A2 Persistent FC Failure]] — Agent makes repeated non-recoverable tool call errors

**Impact:** Task incompleteness, hallucinated outputs, policy violations

**Mitigations:**
- ✅ M13 Guards & Meta-tools — enforce required tools (0.001ms latency)
- ✅ M4 Healing Pipeline — recover from tool call errors (86.7% recovery rate)
- ✅ M1 RI Dispatcher — intervene on entropy spikes
- 🔄 Phase 1.5: M3 retry context tuning for cogito:14b

---

### FM-B: Tool Error Handling

**Definition:** Tools return errors that agent cannot interpret or recover from.

**Categories:**
- [[Failure-Modes/FM-B Tool Errors|FM-B1 Unrecoverable Errors]] — Tool error indicates permanent failure (missing arg, unknown tool)
- [[Failure-Modes/FM-B Tool Errors|FM-B2 Cascade Failures]] — Tool error triggers downstream errors

**Impact:** Loop stalling, task abandonment, user frustration

**Mitigations:**
- ✅ M4 Healing Pipeline — error triage and recovery strategies
- ✅ M11 Diagnostic System — real-time error classification (100% accuracy)
- ✅ M13 Guards — schema validation prevents malformed requests
- 🔄 Phase 1.5: M8 metrics on error cascade frequency

---

### FM-C: Reasoning Quality

**Definition:** Agent reasons poorly or uses flawed logic.

**Categories:**
- [[Failure-Modes/FM-C Reasoning|FM-C1 Red-Herring Reasoning]] — Agent pursues irrelevant directions
- [[Failure-Modes/FM-C Reasoning|FM-C2 Long-Form Regression]] — Accuracy drops with longer contexts

**Impact:** Wasted token budget, task derailment, incorrect conclusions

**Mitigations:**
- ✅ M2 Strategy Switching — pick strategy based on task type (20 tests)
- ✅ M1 RI Dispatcher — intervene on entropy spike
- ✅ M5 Context Curation — 60.7% compression without accuracy loss
- 🔄 Phase 1.5: M7 calibration activation for strategy selection

---

### FM-D: Loop Control

**Definition:** Agent gets stuck in loops or terminates prematurely.

**Categories:**
- [[Failure-Modes/FM-D Loop Control|FM-D1 Infinite Loops]] — Agent repeats same steps indefinitely
- [[Failure-Modes/FM-D Loop Control|FM-D2 Early Surrender]] — Agent gives up before solving task

**Impact:** Token waste, task incompleteness, poor user experience

**Mitigations:**
- ✅ M9 Termination Oracle — single arbitrator (100% path coverage)
- ✅ M1 RI Dispatcher — entropy-driven intervention
- ✅ M11 Diagnostic System — detects loop patterns in real-time
- ✅ IC-1 Loop Detector Fix (Apr 12) — consecutive thought streak tracking

---

### FM-E: Output Quality

**Definition:** Agent produces low-quality or unusable output.

**Categories:**
- [[Failure-Modes/FM-E Output|FM-E1 Empty Content]] — Output is blank, null, or placeholder
- [[Failure-Modes/FM-E Output|FM-E2 Fabricated Specifics]] — Output contains confident but false details

**Impact:** User distrust, unusable results, compliance risk

**Mitigations:**
- ✅ M11 Diagnostic System — output quality validation (0.02ms latency)
- ✅ M3 Verifier & Retry — semantic entropy + evidence grounding
- ✅ M13 Guards — post-synthesis validation
- 🔄 Phase 1.5: M10 memory for context injection

---

### FM-F: Context & Memory

**Definition:** Agent loses context or memory pollutes across runs.

**Categories:**
- [[Failure-Modes/FM-F Context and Memory|FM-F1 Context Overflow]] — Token budget exhausted by excessive context
- [[Failure-Modes/FM-F Context and Memory|FM-F2 Memory Pollution]] — Previous session info bleeds into current session

**Impact:** Task incompleteness, hallucinated "prior knowledge", compliance violations

**Mitigations:**
- ✅ M5 Context Curation — 60.7% compression, 38.6% token savings
- ✅ M10 Memory System — task-scoped queries prevent false injection (66.7% recall)
- 🔄 Phase 1.5: M10 multi-session validation for episodic memory

---

### FM-G: Multi-Turn Coherence

**Definition:** Agent loses coherence or consistency across multiple turns.

**Categories:**
- [[Failure-Modes/FM-G Multi-turn|FM-G1 Coherence Loss]] — Agent contradicts itself or forgets prior context
- [[Failure-Modes/FM-G Multi-turn|FM-G2 Sub-Agent Failures]] — Delegated sub-agent produces invalid output

**Impact:** Long-conversation breakdowns, multi-agent coordination failures

**Mitigations:**
- ✅ M10 Memory System — episodic + procedural layers preserve context
- ✅ M8 Sub-agent Delegation — test harness ready (Phase 1.5 metrics)
- 🔄 Phase 1.5: M10 natural multi-turn scenarios
- 🔄 Phase 2: Integration testing (M2 + M8, M4 + M13)

---

### FM-H: Compliance & Safety

**Definition:** Agent violates rules, policies, or safety constraints.

**Categories:**
- [[Failure-Modes/FM-H Compliance|FM-H1 Schema Violations]] — Output doesn't match required schema
- [[Failure-Modes/FM-H Compliance|FM-H2 Instruction Ignoring]] — Agent ignores explicit constraints

**Impact:** Compliance risk, data loss, safety violations, audit failures

**Mitigations:**
- ✅ M13 Guards & Meta-tools — 6 guards, 100% accuracy, 0.001ms latency
- ✅ M11 Diagnostic System — real-time compliance monitoring
- ✅ M9 Termination Oracle — authorized exit paths only
- ✅ CI lint enforces guard justifications by Phase 3

---

## Failure Mode Evidence

### Phase 1 Evidence Base

| FM | Category | Evidence | Status |
|----|----------|----------|--------|
| FM-A1 | No-Tool Fabrication | Spike data + 12 reproducer tests | ✅ Mitigated by M13 |
| FM-A2 | Persistent FC Failure | 8 reproducer tests, recovery rates | ✅ Mitigated by M4 |
| FM-B1 | Unrecoverable Errors | Error triage classification | ✅ Diagnosed by M11 |
| FM-B2 | Cascade Failures | Multi-tool failure chains | 🔄 Metrics via M8 |
| FM-C1 | Red-Herring Reasoning | Strategy switching tests | ✅ Addressed by M2 |
| FM-C2 | Long-Form Regression | Context curation tests | ✅ Addressed by M5 |
| FM-D1 | Infinite Loops | Loop detection tests | ✅ IC-1 fix validated |
| FM-D2 | Early Surrender | Arbitration tests | ✅ M9 validated |
| FM-E1 | Empty Content | Output quality checks | ✅ M11 detects |
| FM-E2 | Fabricated Specifics | Semantic entropy + NLI | ✅ M3 detects |
| FM-F1 | Context Overflow | Compression ratio tests | ✅ M5 mitigates (60.7%) |
| FM-F2 | Memory Pollution | Task-scoped memory tests | ✅ M10 mitigates |
| FM-G1 | Coherence Loss | Multi-turn tests | 🔄 Phase 1.5 validation |
| FM-G2 | Sub-Agent Failures | Delegation tests | 🔄 M8 metrics pending |
| FM-H1 | Schema Violations | Guard validation | ✅ M13 validates |
| FM-H2 | Instruction Ignoring | Compliance tests | ✅ M13 guards |

### Confidence Levels

- **FM-A, FM-B, FM-D, FM-E, FM-F, FM-H:** HIGH (empirical evidence from 50+ runs)
- **FM-C, FM-G:** MEDIUM (evidence from 20+ runs; Phase 1.5 expansion needed)

---

## Mitigation Strategy Matrix

| Mechanism | FM-A | FM-B | FM-C | FM-D | FM-E | FM-F | FM-G | FM-H |
|-----------|------|------|------|------|------|------|------|------|
| M1 RI Dispatcher | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| M2 Strategy Switching | — | — | ✅ | — | — | — | ✅ | — |
| M3 Verifier+Retry | ✅ | ✅ | — | — | ✅ | — | — | — |
| M4 Healing Pipeline | ✅ | ✅ | — | — | — | — | — | — |
| M5 Context Curation | — | — | ✅ | — | — | ✅ | ✅ | — |
| M6 Skill System | — | — | — | — | — | — | ✅ | — |
| M7 Calibration | — | — | ✅ | — | — | — | — | — |
| M8 Sub-agent Delegation | — | — | — | — | — | — | ✅ | — |
| M9 Termination Oracle | — | — | — | ✅ | — | — | — | ✅ |
| M10 Memory System | — | — | — | — | — | ✅ | ✅ | — |
| M11 Diagnostic System | ✅ | ✅ | — | ✅ | ✅ | — | — | ✅ |
| M12 Provider Adapters | ✅ | ✅ | — | — | — | — | — | ✅ |
| M13 Guards+Meta-tools | ✅ | ✅ | — | — | — | — | — | ✅ |

---

## How to Use This Catalog

1. **When debugging a failure:** Find the symptom in FM-A through FM-H, then check mitigations
2. **When designing a mechanism:** Check which FMs your mechanism mitigates
3. **When validating a fix:** Verify using the reproducer tests listed in the Evidence section
4. **When planning Phase 1.5:** Use the Status column to identify remaining validation work

---

**See also:** [[MOCs/Research MOC|Research MOC]] (improvement loop), [[Failure-Modes|All Failure Mode Details]]

**Last Updated:** May 4, 2026  
**Phase:** Phase 1 Complete  
**Next Review:** Start of Phase 1.5
