---
title: Cross-Tier Weakness Sweep — eval-system-driven harness diagnosis
date: 2026-06-26
tags: [harness, weakness-sweep, failure-modes, eval-system, cross-tier, honesty, verifier]
status: findings → prioritization → execution
related:
  - "[[02-FAILURE-MODES]]"
  - "wiki/Architecture/Design-Specs/2026-06-24-canonical-evaluation-system.md"
---

# Cross-Tier Weakness Sweep (2026-06-26)

First weakness sweep driven by the **canonical eval system** (Phases 1–4b): bench →
`SessionReport` → `RunDiagnosis` → gate → ledger. Two valid runs combined (one run
had an invalid local tier — see §4).

## 1. Data

| Source | Tier | Models | Tasks | runs | Validity |
|---|---|---|---|---|---|
| cross-tier-report (2026-06-26) | frontier | claude-haiku-4-5, gpt-4o-mini | rw-2/3/6/8/9 | 1 | **valid** |
| cross-tier-report (2026-06-26) | local | qwen3:14b, cogito:14b | rw-2/3/6/8/9 | 1 | **INVALID** — all cells `status=error` at 120000ms (timeout) |
| calibrated-report (2026-06-25) | local | qwen3:14b, cogito:14b | rw-2/3/6/8/9 | 1 | **valid** (180s timeout) |

Judge: frozen judge-server, `gemma4:12b` (non-SUT, Rule-4 clean).

## 2. Accuracy + harness lift (bare-llm → ra-full)

| Model | tier | bare-llm | ra-full | lift |
|---|---|---|---|---|
| qwen3:14b | local | 0% | 39% | **+39pp** |
| cogito:14b | local | 40% | 39% | −1pp |
| claude-haiku-4-5 | frontier | 10% | 24% | +14pp |
| gpt-4o-mini | frontier | 10% | 36% | **+26pp** |

**Harness helps every model** (net positive lift), most on weak-bare models
(qwen3 0→39, gpt-4o-mini 10→36), least on already-decent ones (cogito flat). But
**absolute scores are LOW** (≤39%) — these real-world tasks are hard; even
gpt-4o-mini ra-full clears only 36%. The harness is necessary but not sufficient.

## 3. The findings (prioritized)

### W1 — Verifier passes continuation-intent as the final answer  **[P1 — ROOT]**
- **Prevalence:** ~95% of runs flagged `claimed-success (unverified)` /
  `dishonest-success-suspected` **across BOTH tiers** (frontier 18/19; local 19/20).
- **Root cause (trace-verified, `01KW2P19DPX5QAZM6AVSP81J5E`):** the model emits a
  mid-reasoning continuation as its output — e.g. *"Let me analyze the complete data
  by reading it again:"* (trailing colon = about to continue) — and the verifier
  **passes all 7 checks** (`action-success`, `non-empty-content`, `agent-took-action`,
  `output-not-harness-parrot`, `output-not-shallow-giveup`, `completion-claim`,
  `scaffold-leak`). The kernel ships it as `status=done`, accuracy=0.
- **Why the checks miss it:** they validate structure/safety, not *deliverable-vs-intent*.
  `completion-claim` looks for *completion* phrasing; the failure is *continuation*
  phrasing ("Let me…", "Now I'll…", "we can focus on…", trailing colon) shipped as final.
- **FM mapping:** refines/extends FM-C2 (synthesis fabrication) + FM-E (output quality)
  → propose **FM-E3 — continuation-intent shipped as final answer**.
- **Controllability:** HIGH (a verifier check in the kernel). **Highest leverage** —
  one fix addresses the dominant cross-tier failure AND part of W2.

### W2 — Harness over-action on adversarial "no-op" tasks  **[P1]**
- **Prevalence:** systemic regression on **rw-6** ("nothing to optimize") across
  multiple models: cogito:14b **−100pp**, gpt-4o-mini **−50pp**. Also rw-2@claude-haiku −50pp.
- **Root cause (trace output):** ra-full pushes the model to *produce an action* even
  when the correct answer is "no change needed" — gpt-4o-mini invented a merge-sort
  optimization (*"we can focus on reducing memory allocations…"*) on a task whose answer
  is "already optimal." Intertwined with W1 (it ships the intent-to-optimize as the answer).
- **FM mapping:** scope-discipline / over-action failure (FM-C family, honest-uncertainty
  dimension). Partly subsumed by the W1 fix; residual = the harness's bias-to-act.
- **Controllability:** MEDIUM-HIGH (harness prompt + the W1 verifier check).

### W3 — Harness token tax 2–9×  **[P2 — known cost]**
- ra-full vs bare-llm mean tokens: +305% (haiku), +558% (gpt-4o-mini), +207–901% (local).
- Not a bug — the cost of the lift. Relevant because the **gate rejects** even a real
  +19–26pp lift when overhead ≫15%. Worth a separate efficiency lever, not a root-cause bug.

### W4 — Bench measurement trap: local judge starves local SUTs  **[P2 — operational]**
- **All local cells errored at exactly 120000ms** in the 2026-06-26 run — even
  `bare-llm` single-shot. Ollama hosting 3 models (2 local SUTs + the local `gemma4:12b`
  judge) → GPU contention → every local call exceeds the 120s cap.
- **Fix:** for a local-SUT sweep, use a **cloud judge** (no GPU contention) OR a much
  higher timeout, OR don't co-host judge + SUTs. The earlier run (180s, validated)
  succeeded; 120s + co-hosted judge did not.
- **Also:** the bench's calibrated-model preflight blocked the original `local-models`
  session entirely (qwen3:4b/cogito:8b not in `STATIC_CAPABILITIES`) — 20/20 inconclusive,
  0 dishonest numbers (guard working as designed). Add those models to the table or
  retire the stale session defaults.

### W5 — Structural failure-mode detectors silent  **[P3 — observation]**
- `RunDiagnosis.failureModes` tally was **empty** ({}) across the sweep — no
  overlap-storm / nudge-loop / recall-loop / runaway-tokens / max-iter-no-progress fired,
  while the **honesty** detector lit up ~95%. Either these runs don't hit those patterns,
  or the detectors are tuned for longer/heavier traces. Worth confirming the detectors
  aren't under-firing (a blind spot would hide real structural failures).

## 4. Prioritization (frequency × severity × controllability)

| # | Issue | Freq | Sev | Control | Priority |
|---|---|---|---|---|---|
| **W1** | verifier passes continuation-as-answer | ~95% both tiers | high | high | **P1 (do first)** |
| **W2** | over-action on no-op tasks | systemic (rw-6 multi-model) | high | med-high | **P1** |
| W3 | token tax 2–9× | every ra-full run | med | med | P2 |
| W4 | local judge GPU contention | this run | med (measurement) | high | P2 (cheap) |
| W5 | failure-mode detectors silent | unknown | unknown | — | P3 (confirm) |

## 5. Execution plan

1. **W1 first (highest leverage):** add a verifier check that rejects
   **continuation-intent** output (promises future action rather than delivering it) as
   a non-final answer → forces another iteration or an honest failure instead of shipping
   a mid-thought. This is the root of the ~95% honesty crisis and part of W2.
2. **W2:** after W1, re-measure rw-6 regressions; residual = harness bias-to-act on no-op
   tasks (prompt/scope-discipline fix).
3. **W4 (cheap, parallel):** switch local sweeps to a cloud judge; fix/retire the stale
   `local-models` session model ids.
4. Re-run the cross-tier sweep **rigorously** (runs≥3, cloud judge, valid local) to get
   authoritative gate verdicts after the W1/W2 fixes; record each in the ImprovementLedger.

Each harness fix follows the loop: hypothesis → fix → re-bench → `rax eval gate` (lift
rule) → ledger entry. A fix can be structurally correct yet `reject` on lift — both
facts get recorded.
