---
title: Harness Improvement Session 2026-05-28
date: 2026-05-28
tags: [harness, debugging, fabrication, mcp]
---

# Harness Improvement Session — 2026-05-28

## Scope

Triggered by spot-test cogito:14b on `github/list_commits` shipping a
hallucinated `ollama_prices` JSON blob as the final answer. Expanded
into a multi-probe sweep against cogito:14b + qwen3:14b to find related
failure modes.

## Fixes shipped this session

### 1. Output poisoning loop (commit 7acbf351)

`guardEvidenceGrounding` rejected legitimate prose answers whose cited
numbers (e.g. `$77,505`) appeared in raw commit-body text but not in
the per-step `extractedFact` summary. The loop stalled, harness assembled
the 131KB raw tool dump as the deliverable, and `output-gate` forced a
synthesis LLM call that hallucinated unrelated JSON.

- Evidence corpus is now **authoritative** (raw obs ∪ extracted facts).
- `assembleDeliverable` returns source-tagged `Deliverable`; a substantive
  trailing thought wins over raw artifacts.
- New `harness_synthesis` termination reason routes model-authored
  outputs around the forced re-synthesis path.

### 2. Kernel ToolCallStarted gap (folded into 1c08d73)

Reactive/adaptive strategies were silently dropping tool-selection
rationale from `debrief.rationale[]`. Only `plan-execute.ts` and the
runtime `inline-act.ts` published `ToolCallStarted`; the kernel path
emitted `ToolCallCompleted` from `kernel-hooks.onObservation` but never
the symmetric start event.

- `KernelHooks.onAction` accepts optional `{ callId, rationale }`.
- `buildKernelHooks.onAction` publishes `ToolCallStarted` when callId
  is provided. 9 sites in `act.ts` thread `tc.id` + `tc.rationale`.

### 3. Structured-result fabrication (commit 1c08d73)

`compressToolResult` always truncated array results to `previewItems`
(8 on local tier) regardless of whether the full row-summary detail
would fit the byte budget. Listing tasks ("last N commits", "top N
posts") could not succeed when N > previewItems — the model has a
recall path but rarely uses it, defaulting to pattern-completing with
fabricated rows from training data.

- Try-fit pattern: render all rows at title-detail; if joined output +
  header overhead ≤ budget, emit full list with `All N items:` header.
- Otherwise fall back to existing previewItems-truncated path with
  recall hint. Applied to GitHub-commit specialization + generic array.

## Failure modes identified but NOT fixed this session

### F1 — `synthesis-grounded` is structurally a no-op

`validateGeneralizedGrounding` defaults `enableClaimGrounding: false`
to avoid the 64-73% false-positive rate Stage 5 rolled back. Net
effect: the check only catches compression-marker echoes — every other
output trivially passes. cogito:14b T5 traces shipped 0% faithfulness
(quality-gate measure) with `synthesis-grounded: passed`.

Per advisor review, fixing this requires a discriminating
hypothesis distinguishing legitimate paraphrase from fabrication. The
quality-gate's faithfulness metric (cited-titles ratio) and the
verifier's claim-grounding (substring match) are heuristics for
different task shapes. Deferred until cross-tier data establishes
whether the gap is model-behavior or framework-blindness.

### F2 — `output-not-shallow-giveup` patterns too narrow

memory-recall-invocation trace 01KSPAA95TB1VY3AH46TPHWZFW shipped a
805-byte giveup ("It appears that...", "you may want to...", "since
this key is unknown") that passed the check. Five literal regex
patterns miss deflection phrasing.

Adding `you (may|might|should|could) (want to )?(run|call|try)…` would
catch it, but the AND-with-unusedUserTools guard would still let this
specific trace pass (model called both web-search AND recall). Needs a
deflection-detection signal independent of tool usage.

### F3 — Classifier mis-classifies tool requirements

spot-test "How many stars does tylerjrbuell/reactive-agents-ts have?"
classifier emitted `required: web-search` when the canonical answer
source is `github/search_repositories`. Model wasted an iteration on
web-search before pivoting. Affects iteration count + latency.

### F4 — Recall by query when model needs key-lookup

memory-recall-invocation: model called `recall(query: "popular
javascript frameworks")` (semantic-search mode, returned 0 matches)
instead of `recall(key: "_tool_result_N")`. Tool description / system
prompt may not distinguish modes clearly enough for local-tier models.

### F5 — Strategy-switching off by default in spot-test, on in builder

Probe summary showed `interventionsSuppressed > 0` on multiple runs.
RI evaluator flagged stalls but couldn't dispatch — strategy-switching
was explicitly disabled (`enableStrategySwitching: false` in
spot-test.ts). Worth a separate decision: should sensible defaults
keep it on?

## Cross-tier evidence

| Task | cogito:14b composite | qwen3:14b composite |
|------|---------------------|---------------------|
| T1-knowledge-recall    | 100% | 100% |
| T2-single-tool         | 100% | 100% |
| T3-selective-filter    | 67-77% | 88% |
| T4-multi-criteria      | 91% | 91% |
| T5-long-form-synthesis | 65-70% | 65% |
| **avg** | 85-87% | 89% |

T5 is universally weak (both tiers ≤ 70%). T3 is cogito-specific
weakness. qwen3:14b 3pp better overall but inherits the synthesis gap.

## Open hypotheses for next session

- **F1 with task-shape gating**: enable claim-grounding only when
  `taskIntent.expectedEntities.length > 0` (specific named entities).
  Lower false-positive surface than generic enumeration heuristic.
  Validate on T3 (selective filter on named criterion) before broader.
- **F3 classifier rules**: when task contains repo path like
  `owner/repo` AND github tools available, classify `github/*` as
  required, not web-search.
- **Quality-gate scoring revision**: T5's faithfulness metric (literal
  title-citation in paragraph summary) may not match the task's actual
  ask ("categorize by topic"). Reconsider per-task scoring before
  treating T5=0% as a fabrication signal.

---

## Session 2 (2026-05-28 continued)

### Fixes shipped

| Commit | Change | Impact |
|--------|--------|--------|
| `a9ba4f8e` | MCP comprehension trio: plan-execute compression, GitHub SHA in preview, compression-echo synthesis | MCP probe: 67% → 84-86% |
| `ab531990` | Render 6 fields, tighter URL trim, calibration `optimalToolResultChars` 2000→4000 (cogito/qwen3:14b) | Filter task visibility: 8 of 25 → All 25 |

### MCP comprehension probe added

`mcp-comprehension-probe.ts` exercises 5 realistic MCP scenarios via the public
github MCP server (Docker). Tasks: single-record field, array listing, selective
filter, multi-tool workflow, error recovery.

### Comprehensive results

| Probe | cogito:14b | qwen3:14b |
|-------|------------|-----------|
| MCP probe avg | 84-86% (was 67%) | 79% |
| Quality-gate avg | 86% | 89% |

### Bottlenecks identified — root-cause classification

| Class | Symptom | Root |
|-------|---------|------|
| **Compression visibility** ✅ FIXED | Filter tasks see only first 8 of N items | renderRecord shows 4 fields; budget 2000 too tight for modern context windows |
| **Code-path asymmetry** ✅ FIXED | Plan-execute fabricates from training data on listing tasks | plan-execute bypassed kernel's compressToolResult |
| **Synthesis gate blindness** ✅ FIXED | Compression preview echoed as final answer (FM-A2) | decideSynthesisInput skipped compression-marker check on no-format tasks |
| **MCP field stripping** ✅ FIXED | Model fabricates SHAs on filter tasks | GitHub commit preview omitted SHA field entirely |
| **Model attention** ⚠️ OUT-OF-SCOPE | cogito:14b ignores `descendants` field even when visible | Local 14b model behavior — not framework |
| **Long-form synthesis citation** ⚠️ OUT-OF-SCOPE | T5 0% title-citation rate in paragraph summary | Quality-gate metric vs paraphrase mismatch (advisor flagged) |
| **Classifier wrong tool** 📋 NEXT | "Stars on repo X" classified as web-search not github | LLM classifier lacks task-shape heuristic for owner/repo paths |
| **`synthesis-grounded` no-op** 📋 NEXT | Fabrication passes verifier | Claim-grounding disabled by default (Stage 5 rollback) |

### Open hypotheses for next session

- **Classifier post-process rule**: when task contains `owner/repo` path AND github
  tools available, demote web-search from required → relevant. Pure heuristic,
  no LLM round-trip.
- **Task-shape gated `synthesis-grounded`**: enable only when
  `taskIntent.expectedEntities.length > 0`. Lower false-positive surface than the
  general claim-grounding case Stage 5 rolled back.
- **Per-tier render-detail calibration**: bump cogito:8b, qwen2.5:14b, llama3:14b
  to 4000 once individually validated.

