---
tags: [evidence, matrix-analysis, q2b]
date: 2026-05-23
campaign-step: 3
answers: Q2b (cross-strategy quality variance) + new findings
basis: cross-strategy-matrix-2026-05-23-03:34.json (40 cells, 2 models × 4 strategies × 5 tasks)
---

# Cross-Strategy Matrix Analysis

40 cells. cogito:14b + qwen3:14b × {reactive, plan-execute-reflect, reflexion, tree-of-thought} × 5 tasks.

## TL;DR — surface `success=true` was lying

All 40 cells reported `success=true`. **Real outcome quality varies massively** across (model, strategy, task) cells. New findings:

| # | Finding | Severity |
|---|---|---|
| **M1** | `result.metadata.totalTokens=0` across ALL 40 cells | 🔴 **CATASTROPHIC silent data loss** |
| **M2** | 7/40 cells (17.5%) ship raw `<rationale call="N">...` XML as user-facing output | 🔴 **CATASTROPHIC output-quality bug** |
| **M3** | qwen3:14b + ToT = 250-300s per task (5-10× cost vs reactive) for minimal outcome gain | 🟠 efficiency black hole |
| **M4** | Strategy outcome is strongly model-dependent — same strategy on same task produces 13× variance | 🟠 reliability gap |
| **M5** | reflexion + ToT abandon content depth on multi-step tasks (-93% outLen vs reactive on t4) | 🟠 strategy mismatch |
| **M6** | output shape inconsistent across (model, strategy) cells — same task returns "391" vs 121-char wrap | 🟡 UX inconsistency |
| **M7** | success=true reported on cells where log shows "✗ failed to produce output" | 🔴 trust violation |

## Q2b answer

**Cross-strategy outcome variance: WIDE on quality + cost dimensions, but BINARY-SUCCESS hides it.**

Quality variance examples (cogito:14b × t4-multistep): output length range 139 → 2319 chars. reflexion + ToT produce <10% of reactive's content. Same task, same model — strategy choice IS load-bearing.

Cost variance examples (qwen3:14b × all tasks): ToT 191-303s vs reactive 13-51s. **5-10× cost penalty per task.** 

This **invalidates the drift analysis's morph priority** that assumed cross-strategy variance was theoretical. It's empirically real and severe. The capability mapping conclusion ("strategies encode genuine algorithmic divergence") is reinforced — they really do produce different outcomes. **But** the divergence is currently invisible to `success` bool, which means downstream consumers (telemetry, calibration, M7 routing) operate on a useless signal.

---

## Finding M1 — totalTokens=0 universal silent loss 🔴

Every cell shows `tokens=0` in the result metadata. **Phase logs print real numbers** (e.g., `📊 [metric:tokens_used] 26191 tokens` in cell 39). The wiring break:

- `EmitLog` event `_tag: "metric", name: "tokens_used"` fires correctly.
- `result.metadata?.totalTokens` reads as 0.

This breaks: cost accounting, RunReport, OTel exporter, M7 calibration consumer, every dashboard. **Trust differentiator violated. Mission Statement L1: silent metadata loss = bug.**

Root cause: likely in `engine/finalize/run-finalization.ts` or wherever `ExecutionResult.metadata` is constructed. The metric event lands on EventBus but is not folded back into the result.

**Fix priority: P0** — universal across models, strategies, tasks. Any user with cost accounting is reading zeros.

---

## Finding M2 — `<rationale call="N">` XML leaks as final output 🔴

**7 of 40 cells (17.5%) return raw rationale XML as user-facing output.** All on cogito:14b. Cross-strategy:

| Cell | outputPreview (first 80 chars) |
|---|---|
| cogito:14b reactive t1-trivial | `<rationale call="1">{"why":"direct calculation of multiplication...` |
| cogito:14b reflexion t1-trivial | `<rationale call="1">To calculate the multiplication of two numbers...` |
| cogito:14b reflexion t4-multistep | `<rationale call="2">need full-text indexing info to complete...` |
| cogito:14b reflexion t5-critique | `<rationale call="2">I need to summarize the trade-offs...` |
| cogito:14b ToT t3-tool | `<rationale call="1">Since the web search returned no usable results...` |
| cogito:14b ToT t4-multistep | `<rationale call="2">I should explore existing knowledge about indexing...` |
| cogito:14b ToT t5-critique | `<rationale call="1">Now that I understand the basics, I need to compare...` |

**Root cause:** `think.ts:455` shows the rationale wrapper is **prompt scaffolding** instructing models on rationale format. cogito:14b parrots the schema even when no tool call follows. `think.ts:1138-1175` only strips/attaches rationale blocks when `accumulatedToolCalls.length > 0`. **No tool call → rationale wrapper leaks into thought → thought ships as output.**

Verifier passes all 7 cells. `agent-took-action` check uses tool-call count but `output-not-harness-parrot` check doesn't catch model-emitted-prompt-scaffolding.

**Fix priority: P0** — verifier blind to a structural output failure on a default tier model. F4 territory but worse: this isn't shallow give-up, it's literal internal markup as user output.

Fix shape: 
1. Output assembly strips `<rationale ...>...</rationale>` blocks from `state.output` unconditionally.
2. Verifier `output-not-harness-parrot` check adds `<rationale ` as a blocked prefix pattern.
3. Long-term: this is symptom of prompt-scaffolding leaking into output (M2 anti-pattern). Restructure prompts to use markers the model won't reproduce in user-facing text.

---

## Finding M3 — qwen3:14b × ToT cost black hole 🟠

| Task | Reactive | Plan-Execute | Reflexion | **ToT** |
|---|---|---|---|---|
| t1-trivial | 13s | 22s | 26s | **303s** |
| t2-factual | 23s | 14s | 18s | **191s** |
| t3-tool | 22s | 47s | 30s | **271s** |
| t4-multistep | 23s | 55s | 54s | **273s** |
| t5-critique | 51s | 68s | 32s | **254s** |

ToT on qwen3:14b: **23× more expensive than reactive on t1-trivial** (303s vs 13s). For a multiplication task. The BFS exploration runs even on trivial inputs.

**Adaptive strategy routing should rule out ToT for trivial tasks.** Currently it's user choice — there's no tier-aware ToT depth cap (despite `tree-of-thought.ts:43-50` declaring `ToTTierLimit`).

Per-cell tokens for qwen3 ToT t5-critique cell 40 log: **31,533 tokens for 572 chars of output.** Token-per-char ratio absurd.

**Fix priority: P1** — tier-aware ToT depth gate must hard-fail on trivial-complexity tasks OR ToT must self-detect "this task doesn't need BFS" and bail. Adaptive routing must include cost gates, not just routing.

---

## Finding M4 — strategy outcome model-dependent 🟠

Same (strategy, task) → wildly different output across models:

- **reflexion × t5-critique:** cogito = 169 chars (rationale-XML leak), qwen3 = 2290 chars (real synthesis).
- **reflexion × t4-multistep:** cogito = 139 chars (XML leak), qwen3 = 745 chars.
- **plan-execute × t1-trivial:** cogito = 3 chars ("391"), qwen3 = 3 chars ("391"). 

So on cogito, reflexion+ToT pipeline produces less useful output BECAUSE of rationale leak (M2). On qwen3, they don't leak rationale.

**Strategy quality is gated by model FC compliance.** Calibration-driven strategy selection (per Phase 1.5 M7) is structurally necessary, not optional. Currently absent.

---

## Finding M5 — reflexion + ToT under-explore content on multi-step tasks 🟠

On cogito:14b × t4-multistep:
- reactive: 2238 chars (covers all 3 indexing strategies)
- plan-execute: 2319 chars (covers all 3)
- reflexion: 139 chars (rationale leak — only one strategy mentioned)
- ToT: 153 chars (one strategy mentioned)

On qwen3:14b × t4-multistep:
- reactive: 1441 chars
- plan-execute: 1415 chars
- reflexion: 745 chars (52% of reactive)
- ToT: 857 chars (60% of reactive)

**Reflexion and ToT spend tokens on critique/exploration but commit less to final synthesis.** For multi-step coverage tasks they under-produce.

**Implication for adaptive routing:** "multi-step task → plan-execute-reflect" heuristic is empirically supported here. Reflexion is for critique-amenable tasks (t5), ToT is for problems with discrete candidate solutions, not enumeration tasks.

---

## Finding M6 — output shape inconsistency 🟡

Same task across (model, strategy) cells returns wildly different output shapes:

t1-trivial ("17 × 23?"):
- cogito reactive → `<rationale ...>{"why":"direct calculation..."}</rationale>` (121ch noise)
- cogito plan-execute → `391` (3ch, correct, minimal)
- cogito reflexion → `<rationale ...>...` (168ch noise)
- cogito ToT → 194ch
- qwen3 across all → `391` (3ch)

t2-factual ("capital of Australia?"):
- cogito reactive → "Canberra is the capital of Australia, established as the national seat..." (114ch prose)
- cogito plan-execute → "Canberra is the capital city of Australia." (42ch sentence)
- qwen3 reactive → 37ch sentence
- All other qwen3 → 37ch

**Format consistency is model-driven, not framework-driven.** Users can't predict output verbosity. This breaks downstream parsing.

**Fix shape:** explicit output format negotiation (currently buried in `final-answer.ts` `buildFinalAnswerDescription`). Task should hint format; framework should normalize.

---

## Finding M7 — success=true on visibly failed runs 🔴

Cell 40 log: `✗ [completion] Tree-of-thought failed to produce output` followed immediately by `✓ [completion] Task completed in 254.4s with 31533 tokens` and `success=true` in result.

Either the success bool ignores ToT's own failure signal, OR ToT's failure surfaces as a soft warning. Either way: **user reads success=true; framework says ✗ in logs; nobody reconciles.**

Same trust-violation class as M1. The framework lies to its API consumer.

**Fix:** ToT `failed to produce output` path must propagate to `success: false` in ExecutionResult.

---

## How this updates the campaign and morph spec

### Updates to drift analysis

Capability-mapping conclusion holds: strategies encode genuine algorithmic divergence. M5 reinforces: reflexion ≠ reactive ≠ ToT ≠ plan-execute. Replacing them with declarative compositions is harder than initial advisor frame suggested.

### Updates to mission statements

- L1 metric: **`result.success` must reflect actual outcome quality, not just non-throwing run.** Current bool is unreliable. Either remove or make accurate.
- L1 metric: **`result.metadata.totalTokens` must match emitted phase metrics.** Add CI check.
- Anti-mission #4 ("NOT a system that hides failure") **already violated by M7.** Promote enforcement.

### Updates to morph priorities

**Phase 0 — emergency surface bug class (NEW, before Phase 1):**
1. M1 totalTokens wiring break (P0)
2. M2 rationale XML output leak (P0)
3. M7 ToT failure-to-success bool propagation (P0)
4. M3 ToT tier-aware cost gate (P1)

These are NOT architecture moves. They're symptoms of a more fundamental issue: **the result surface is not trustworthy.** Until M1/M2/M7 close, every higher-altitude empirical comparison (Q1, Q3, gate corpus) reads through a lying API.

The drift analysis Phase 1 was "convergence foundations." **Phase 0 is "stop the surface from lying."** No phase priority makes sense above Phase 0.

### Q2b revised threshold answer

- **Q2a (capability mapping):** <30% mappable → drift threshold ≥70% NOT MET → strategies stay as primitives.
- **Q2b (cross-strategy variance):** WIDE, but obscured by lying success bool + token=0 metadata. **Quality variance is real**, gating adaptive routing decisions. **Outcome variance is genuine**, supporting capability-mapping verdict.

Combined: strategies are real algorithmic primitives with real outcome differences AND the framework's outcome reporting is currently unreliable. **Both findings are required to size the morph correctly.**

---

## Steps still to run

- Step 4 within-session learning delta (M6/M10) — pending matrix completion (now done)
- Step 5 cross-session repeat — pending M6 persistence confirmed
- Step 6 RI ablation — **launched in background (task ID bw4081ahz)**
- Step 7 tier expansion incl gpt-4o-mini — pending key confirmation

Next: wait for RI ablation; in parallel verify M6 persistence wiring before kicking step 5.
