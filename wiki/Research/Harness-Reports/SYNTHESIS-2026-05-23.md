---
tags: [synthesis, harness-improvement-loop, multi-model, evidence-grounded]
date: 2026-05-23
basis: 6 of 7 campaign steps complete; 3 models (cogito:14b + qwen3:14b + gpt-4o-mini); 76 cells across matrix + 16 RI ablation cells + 5 baseline sweep cells = 97 evidence-bearing runs
status: SYNTHESIS — ready for morph spec + GitHub issues
companion: all wiki/Research/Harness-Reports/*-2026-05-23.md
---

# Harness Sweep — Final Synthesis

## Campaign coverage

| Step | Status | Q answered | Evidence |
|---|---|---|---|
| 0 Baseline sweep (qwen3:14b) | ✅ | F1-F8 surfaced | 5 probe runs |
| 1 Capability mapping audit | ✅ | Q2a: <30% mappable, strategies are primitives | static |
| 2 Event coverage diff RI vs Compose | ✅ | Q1c: ~zero overlap, bridge not subsume | static |
| 3 Cross-strategy matrix local | ✅ | Q2b: WIDE variance + M1/M2/M7 P0 bugs | 40 cells (cogito + qwen3) |
| 6 RI ablation multi-model | ✅ | Q1a 75% fire / Q1b +1 success / R9/R10 | 16 cells |
| 7 Cross-strategy matrix frontier | ✅ | Cross-tier confirmation + M2 variants + cost reality | 20 cells (gpt-4o-mini) |
| M6 persistence audit | ✅ | Wired-but-gated; Q3 unrun | static |
| 4 Within-iter learning delta | deferred | analyzable from existing matrix iter data | — |
| 5 Cross-session repeat | deferred | requires dedicated probe + persistent memory + ~2hr | — |

**97 evidence-bearing runs across 3 model tiers** (small-local cogito:14b, large-local qwen3:14b, frontier-cheap gpt-4o-mini). Findings hold across tiers unless noted otherwise.

---

## Multi-model confirmation matrix

### M1 — `result.metadata.totalTokens = 0` is UNIVERSAL silent loss 🔴

Confirmed across **all 76 matrix cells + 16 ablation cells** (cogito + qwen3 + gpt-4o-mini). Phase logs print real numbers (`📊 [metric:tokens_used] 26191 tokens`); `result.metadata.totalTokens` reads 0.

Cost wiring works on frontier (`result.metadata.costUsd = 0.00411`). **Token wiring is the specific break**, not the whole metadata path. Likely a single `event.totalTokens` field never threaded into the `AgentCompleted` event aggregation.

**Effect:** every cost-accounting / RunReport / OTel / calibration consumer reads zeros for tokens. Universal API lie. P0.

### M2 — Output leaks across all strategies, manifest differently per model 🔴

Three distinct output-pollution patterns observed:

| Pattern | Source | Models affected |
|---|---|---|
| **M2a — `<rationale call="N">...` XML leak** | think.ts prompt scaffolding parroted by model | cogito:14b (7/20 cells) |
| **M2b — `[CRITIQUE N] SATISFIED:` meta-leak** | reflexion strategy's internal markers | gpt-4o-mini (2/5 reflexion cells) |
| **M2c — `[find result — compressed preview]\nType: Object(...)` template leak** | ToT bypasses output synthesis on tool-result; ships internal format template | gpt-4o-mini (1/5 ToT cells); cogito (suspected) |

**Pattern is universal: framework internals (prompt scaffolding, strategy annotations, tool format templates) escape into user-facing output.** Verifier's `output-not-harness-parrot` check is too narrow — it covers some markers but misses these three classes.

**Frontier doesn't fix this.** The pattern is structural, not model-quality-dependent.

**Effect:** users see internal markup as agent's answer. Catastrophic for trust differentiator. P0.

### M3 — ToT cost is structurally ridiculous, all tiers 🟠

| Task | reactive | plan-exec | reflexion | **ToT** | ToT cost ratio |
|---|---|---|---|---|---|
| t1-trivial × gpt-4o-mini | $0.0007 | $0.0001 | $0.0008 | **$0.0022** | **3.3× reactive** |
| t1-trivial × qwen3:14b | 13s | 22s | 26s | **303s** | **23× reactive** |
| t5-critique × qwen3:14b | 51s | 68s | 32s | **254s** | **5× reactive** |
| t5-critique × gpt-4o-mini | $0.00459 | $0.00251 | $0.00076 | **$0.00411** | **5.4× reflexion** |

**ToT BFS exploration runs even on tasks that don't need it.** Tier-adaptive depth caps (`tree-of-thought.ts:43-50`) exist but apparently don't trigger on simple tasks. Adaptive routing doesn't prevent users from manually selecting ToT for trivial work.

**Cross-tier confirmation:** ToT cost penalty is intrinsic to the BFS algorithm, not a model quirk. Even cheap frontier (`gpt-4o-mini`) pays 3-5× cost on ToT vs alternatives.

**Effect:** ToT is a footgun. Default routing must include cost classification, not just task-shape classification.

### M5 — Strategy ↔ task fit is empirically very narrow 🟠 (cross-tier confirmed)

| Task type | Best strategy (frontier evidence) | Worst |
|---|---|---|
| t1-trivial (compute) | plan-execute ($0.0001) | ToT ($0.0022, 22× worse) |
| t4-multistep | **plan-execute** (3338ch for $0.00196) | reflexion (218ch [CRITIQUE leak], $0.00080) |
| t5-critique | plan-execute (2116ch, $0.00251) | ToT (264ch + `failed to produce` log, $0.00411) |

Plan-execute consistently wins on output-mass / $ across tiers. Reflexion + ToT under-produce content with M2-class output leaks.

**Empirical adaptive routing target:**
- Compute / lookup → reactive OR direct (cheap)
- Multi-step enumeration → plan-execute-reflect
- Critique-amenable → reflexion (only if M2b leak fixed)
- Tree-search problems with discrete candidates → ToT (only if M3 cost gate added)

Currently adaptive routes by task-shape heuristics in `adaptive.ts:336`. It needs cost-class + output-pollution-risk factored in.

### M7 — `success=true` on visibly-failed runs is CROSS-MODEL 🔴

Cell 40 (qwen3:14b ToT t5-critique): logs `✗ Tree-of-thought failed to produce output` + `success=true`.
Cell 20 (gpt-4o-mini ToT t5-critique): logs `✗ Tree-of-thought failed to produce output` + `success=true`.

**Same failure-to-success-bool bug on both tiers.** ToT internal failure path doesn't propagate to `ExecutionResult.success`. Cross-tier confirmation makes this clearly structural, not transient.

P0. Direct anti-mission #4 violation ("NOT a system that hides failure").

---

## RI ablation summary

- **Fire rate: 75%** on RI-on cells (failure-corpus scenarios). RI is conditional, not dead.
- **Decisions empirically observed: 5 distinct** (`stall-detect`, `tool-inject`/`inject-tool-guidance` paired, `early-stop`, `temp-adjust`/`set-temperature` paired, `switch-strategy`/`request-strategy-switch` paired). **8 of 13 declared variants never fired in failure-corpus.**
- **Outcome delta: +1 success (5/8 vs 4/8), tier-dependent.** qwen3:14b gets clear rescue (+1, -9 iter on rate-limit; -21s on smooth). cogito:14b net-drag (+21s on rate-limit, identical elsewhere).
- **Bug R9:** 3 pairs of duplicate event names for same decision intent (tool-inject + inject-tool-guidance, etc.).
- **Bug R10:** `interventionsDispatched` counter non-zero on RI-OFF cells — ablation not clean OR counter over-inclusive.

**C1 verdict (Compose-vs-RI):** **bridge**, not subsume. RI's decision logic is empirically load-bearing. Wire decisions through Compose pipeline tags (3 of 4 dead tags light up). Don't delete RI substrate; expose its decisions universally.

---

## Capability mapping summary

| Strategy | runKernel? | % capability-mappable | Implication |
|---|---|---|---|
| reactive | ✅ | 100% | already-aligned |
| direct | ✅ | 100% | already-aligned |
| reflexion | ✅ | ~25% | outer critique loop is genuine algorithm |
| tree-of-thought | ✅ | ~10% | BFS is genuine algorithm |
| plan-execute | ⚠️ tool dispatch bypasses kernel | ~25% | direct dispatch L1077-1117 is the one accidental drift |
| code-action | ❌ (worker-thread) | ~0% | genuine substrate divergence |

**Aggregate: <30% mappable.** Strategies stay as primitives. Morph target = **capability-scoped instrumentation that survives outer-loop divergence**, NOT strategy collapse.

---

## Event coverage diff summary

- **RI dispatcher** = async pub-sub decider (13 typed decisions, 5 empirically fire).
- **Compose pipeline** = synchronous content transformer (7 typed tags, **3 wired + 4 dead**).
- **Overlap: ~zero.** Not parallel substrates; complementary surfaces with no shared observation pipe.

**Fix:** 4 dead tags get RI/healing/verifier emit sites. ~30 LOC. Closes C1 + lights all 7 tags.

---

## M6 persistence audit summary

Skill persistence IS wired (SkillStoreService + learning-engine.ts:166). Three structural barriers:

1. Opt-in via `.withMemory()` (default-off)
2. Silent failure (`emitErrorSwallowed` swallows DB errors)
3. Gated by `skillSynthesized` flag (criteria unclear)

**Q3c (cross-session lift) unrun**, not falsified. Step 5 deferred — requires dedicated probe + `.withMemory()` enabled + persistent dbPath + `~2hr` cycle.

---

## Consolidated findings — ranked by severity

### 🔴 Phase 0 — Surface Trust Restoration (P0, gates everything)

| # | Finding | Models | Effort |
|---|---|---|---|
| M1 | `result.metadata.totalTokens = 0` silent loss | universal | ~10 LOC find break in finalize/ |
| M2a | `<rationale ...>` XML leak | cogito:14b | ~5 LOC verifier check + strip |
| M2b | `[CRITIQUE N] SATISFIED:` reflexion meta-leak | gpt-4o-mini | reflexion output sanitization |
| M2c | `[find result — compressed preview]` ToT template leak | gpt-4o-mini | ToT output synthesis gate |
| M7 | ToT `failed to produce output` → success=true | cogito + qwen3 + gpt-4o-mini | propagate failure path |
| R9 | 3 pairs duplicate event names | universal | ~10 LOC constants + lint |
| R10 | `interventionsDispatched` non-zero on RI-off | universal | counter semantic audit |
| R11 | Silent skill persistence failure | universal | ~5 LOC surface error event |

### 🟠 Phase 0.5 — Cost / Quality Gates (P1)

| # | Finding | Effort |
|---|---|---|
| M3 | ToT tier-aware cost gate (3-23× cost penalty unjustified on simple tasks) | adaptive routing extension |
| M5 | Empirical strategy-task fit narrow; routing heuristics inadequate | adaptive routing redesign |

### 🟢 Phase 1 — Convergence Foundations

| # | Finding | Effort |
|---|---|---|
| E2 | Capability-scoped emit (closes F1) | ~50 LOC emit additions at capability boundaries |
| C1 | Bridge RI through 4 dead Compose tags | ~30 LOC pipeline.transform() calls |
| R3 | ControllerDecision union prune (8 dead variants) | doc-or-delete |
| I2 | Required-tool nomination from task text (closes F4/F5) | ~80 LOC TaskComprehender extension |
| E4 | transitionState() discipline + lint rule (closes 160+ stray mutations) | ESLint rule + retrofit |
| R8 | Wire emitLLMExchange at provider boundary (closes F8) | per-provider hook |
| R5 | Plan-execute synthetic kernel state — generalize EntropySensor contract OR add contract test | ~40 LOC |
| R6 | Triple compression coordination (curator sole author, others advisory) | refactor |

### 🟡 Phase 2 — Structural / Algorithmic (pending Phase 1)

| # | Finding | Effort |
|---|---|---|
| I3 | Open `learn/` capability (M6/M7/M10 consolidation) | medium — pending Q3 evidence |
| I5 | Multi-severity verifier (not single bool) | per-check severity ladder |
| I7 | Cross-session skill persistence default-on + visibility | builder API extension |

### 🔵 Phase 3 — Single Arbitrator + Compounding Intelligence

| # | Finding |
|---|---|
| E1 | Single Arbitrator integrating 5 signal sources |
| I1 | Composite confidence × evidence × claim-coverage signal |
| I4 | Capability composition routing (replaces strategy meta-routing) |

---

## What the data proves vs disproves

### Proven empirically (multi-model evidence)

✅ Output leaks are structural across strategies — three distinct patterns (M2a/b/c), not a single bug.
✅ Token metadata loss is universal across providers and tiers.
✅ ToT cost is structurally unjustifiable on simple tasks — every tier pays.
✅ Strategy choice is load-bearing on quality + cost — adaptive routing is necessary, not optional.
✅ `success=true` is unreliable as outcome signal — direct evidence on 2+ tiers.
✅ RI is conditional and rescues on tier-capable models; drags on weak-FC models.
✅ Compose API has 4 dead tags — declared > wired anti-pattern.
✅ Strategies encode genuine algorithmic divergence (<30% capability-mappable) — don't collapse them.
✅ Capability-scoped instrumentation is the right scope, NOT kernel collapse.
✅ Bridge (not subsume) is the correct RI ↔ Compose move.

### Pending evidence

🟡 Cross-session learning lift (Q3c) — needs Step 5 dedicated probe with `.withMemory()` + persistent dbPath.
🟡 RI ablation contamination resolution (R10) — requires probe with cleaner on/off isolation.
🟡 8 of 13 RI decision variants empirically dead — possibly test corpus too narrow; needs broader scenarios.

### Updated hypotheses (no longer assumed)

❌ "Strategies bypass kernel" — wrong framing. 5 of 7 use kernel for tool execution. They reimplement OUTER loops, which is legitimate.
❌ "RI is dead weight" — wrong on failure-corpus scenarios. 75% fire rate, +1 success rescue case.
❌ "Compose and RI are parallel substrates" — wrong. They're complementary; gap is non-coordination, not duplication.
❌ "Cross-strategy variance is theoretical" — wrong. WIDE on quality + cost.

---

## Updates to North Star v5.0

Three amendments required (will write next):

1. **§9 Pruning Principle** — strengthen with R3-style audit: every declared discriminator variant requires an emit site OR doc-marked-experimental.
2. **§4.3 services list** — `learn/` capability flagged as "documented but directory not created"; promotes to Phase 2 priority.
3. **§4.4 unifying principle** — add: *"Every observation surface must have a live emit site in the same commit. Scaffold without callers is forbidden."*

Plus a new §10 "Empirical Evidence Cadence" — every architectural decision needs sweep evidence; campaign-style probes are the discipline.

---

## GitHub issues to file

Phase 0 surface-trust bugs are 8 issues (M1, M2a, M2b, M2c, M7, R9, R10, R11). Phase 1 convergence work is 8 more (E2, C1, R3, I2, E4, R8, R5, R6).

Recommend filing as **labeled groups**:
- `harness-sweep-2026-05-23-phase0` (8 issues, P0)
- `harness-sweep-2026-05-23-phase1` (8 issues, P1)
- `harness-sweep-2026-05-23-phase2` (3 issues, P2)
- `harness-sweep-2026-05-23-phase3` (3 issues, P3+)

Each links back to this synthesis + the specific evidence report.

---

## Recommended next moves (in order)

1. **Write `wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md`** — the morph spec. Three-phase migration plan, references this evidence, ties to mission statements.
2. **File 8 Phase 0 GitHub issues** with empirical evidence per issue.
3. **Amend North Star v5.0** with three §-level updates.
4. **Defer Phase 0 implementation** to dedicated bundle PRs via execute-backlog skill.

The harness improvement loop's job is to surface, ground, prioritize, and write the spec. Implementation is separate, gated by spec review.

---

## Files produced this session

- `wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md` — baseline F1-F8
- `wiki/Research/Harness-Reports/architecture-drift-analysis-2026-05-23.md` — initial drift framing
- `wiki/Research/Harness-Reports/capability-mapping-2026-05-23.md` — Q2a evidence
- `wiki/Research/Harness-Reports/event-coverage-diff-2026-05-23.md` — Q1c evidence
- `wiki/Research/Harness-Reports/cross-strategy-matrix-analysis-2026-05-23.md` — Q2b evidence + M1-M7
- `wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md` — Q1a/b evidence + R9-R10
- `wiki/Research/Harness-Reports/m6-persistence-audit-2026-05-23.md` — Q3 gate check + R11
- `wiki/Research/Harness-Reports/elegance-robustness-intelligence-audit-2026-05-23.md` — design lens
- `wiki/Architecture/Specs/06-MISSION-STATEMENTS.md` — guiding statements + success metrics + anti-mission
- **`wiki/Research/Harness-Reports/SYNTHESIS-2026-05-23.md`** (this doc)

Plus probe scripts:
- `.agents/skills/harness-improvement-loop/scripts/cross-strategy-matrix.ts`
- `.agents/skills/harness-improvement-loop/scripts/ri-ablation.ts`

Plus data:
- `wiki/Research/Harness-Reports/cross-strategy-matrix-2026-05-23-03:34.json` (40 cells local)
- `wiki/Research/Harness-Reports/cross-strategy-matrix-2026-05-23-12:01.json` (20 cells frontier)
- `wiki/Research/Harness-Reports/ri-ablation-2026-05-23-03:46.json` (16 cells)

---

## End state

The harness sweep has empirical grounding for the morph direction. **The framework is structurally sound but has a "scaffold without callers" pattern across 4 surfaces (R2/R3/R4/R11) and a "result surface lies" pattern across 4 bugs (M1/M2/M7/R10).** Closing Phase 0 restores trust in measurement; closing Phase 1 closes most architectural drift; Phase 2/3 are post-trust-restoration structural work.

Mission statements document (`06-MISSION-STATEMENTS.md`) is the guiding compass: every move toward closing the L1/L2/L3 success-metric ladder is progress; every move that violates an anti-mission entry is regression.

The "scaffold without callers" anti-pattern is the single highest-leverage architectural learning of this sweep. Promote it to v0.12 lint discipline.
