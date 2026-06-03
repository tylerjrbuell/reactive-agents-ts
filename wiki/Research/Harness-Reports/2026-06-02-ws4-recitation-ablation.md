---
title: WS-4 Progress-Recitation Ablation — cross-tier pass^k gate
date: 2026-06-02
status: complete
verdict: NEUTRAL on fixed grader (confound closed) — recitation stays opt-in, not harmful, viable lever
tags: [ablation, recitation, post-conditions, pass-k, measurement-spine]
---

# WS-4 Progress-Recitation Ablation

> **⚠️ HEADLINE (corrected post-hoc): the −29pp below is a MEASUREMENT ARTIFACT, not a recitation verdict.**
> The judge grades the agent's final **text** only (`judge.ts:scoreWithJudge` → `sutResponse: output.slice(0,1500)`); it never receives the produced **file** (`report.md`/`prices.md` in `tmpDir`), even though both tasks' rubrics grade "the file is written + contains a table/prices." Recitation steers the model to put the deliverable in the FILE → thinner text answer → the text-only judge scores it lower. The qwen3.5 rw-9 **100%→0%** collapse is the textbook shape: ra-full returned prices in text (graded 100), ra-recite wrote them to the file (graded 0). **The instrument is blind to exactly the channel recitation moves the work into.**
>
> What IS settled: recitation stays **opt-in** (no positive lift proof — correct either way). What is NOT: recitation's true effect on task success — this ablation cannot measure it for file-deliverable tasks.
>
> **Real finding: a hole in the "honest grading" half of the measurement spine** — `llm-judge` accuracy on any file-deliverable task is blind to the file. See "Decision" → fork.

First live-judged measurement against the now-online judge (:8910, claude-haiku-4-5 ≠ SUT). Tests whether the `goal_state` per-turn recitation (rendered into the system prompt via `systemPromptStage`) lifts accuracy on condition-bearing tasks.

## Setup

- **Variants:** `ra-full` (recitation OFF) vs `ra-recite` (`RA_RECITE=1`, only difference is the env-gated `goal_state` emission in `fromKernelState`).
- **Tiers:** qwen3.5:latest (local) + gpt-4o-mini (mid).
- **Tasks:** rw-3 (`write a report to report.md`) + rw-9 (`write a summary to prices.md`) — file-write deliverables, the drift-to-prose failure class the PostCondition spine targets. `deriveConditions` confirmed to emit `[ArtifactProduced, ToolCalled(file-write)]` on both (verified on the bench's absolute-path-rewritten prompts).
- **N=3 → pass^k. 24 dispatches. Live judge + per-cell capability-source preflight.**
- Mechanism-fired proof: `RA_RECITE=1` renders `"Remaining steps: write the file ./prices.md, call the \`file-write\` tool"` into the assembled system prompt (unit + manual project() check). Traces don't capture the system prompt, so absence of the marker in JSONL is not a misfire.

## Result — FAILS the lift rule

| Dimension | ra-full | ra-recite | Δ |
|---|---|---|---|
| **accuracy** | **60%** | **31%** | **−29pp** |
| scope-discipline | 40% | 37% | −3 |
| reasoning | 21% | 19% | −2 |
| reliability | 93% | 95% | +2 |
| resilience | 21% | 5% | −16 |
| tool-mastery | 12% | 5% | −7 |

Per-cell accuracy (mean of N=3):

| Cell | ra-full | ra-recite |
|---|---|---|
| qwen3.5 rw-3 | 88% | 85% |
| qwen3.5 rw-9 | 100% | 0% |
| gpt-4o-mini rw-3 | 52% | 38% |
| gpt-4o-mini rw-9 | 0% | 0% |

The project lift rule for default-on is **≥3pp first-attempt lift AND ≤15% token overhead**. ra-recite delivers **−29pp** — the opposite direction. **No default flip. `recitationEnabled()` stays opt-in.** The gate did its job: an unproven mechanism was prevented from shipping default-on.

## Caveats (do not over-conclude)

- **Small N.** 8 cells, N=3, 2 tasks. The aggregate is dominated by **qwen3.5 rw-9 100%→0%** — a single cell. Three of four cells show only a mild −3..−14 drift; one collapses. This is enough to **fail the +3pp bar** but NOT enough to claim recitation is universally *harmful* vs noisy.
- The collapse cell (qwen3.5 rw-9) is the one task where ra-full already scored 100% — i.e. recitation broke a task the harness was already solving. That direction (regressing a solved task) is the concerning signal worth a trace diagnosis before any recency-placement retry.

## Re-run on the FIXED grader (judge now sees produced files) — verdict: NEUTRAL, confound confirmed

After `f4e1fcbe` (judge grades text + produced files) the ablation was re-run identically.

| Cell | broken-grader (full→recite) | FIXED-grader (full→recite) |
|---|---|---|
| qwen3.5 rw-3 | 88 → 85 | 87 → 88 |
| **qwen3.5 rw-9** | **100 → 0** ⚠️ | **98 → 100** ✓ |
| gpt-4o-mini rw-3 | 52 → 38 | 62 → 62 |
| gpt-4o-mini rw-9 | 0 → 0 | 0 → 0 |

Aggregate dimensions (fixed grader): accuracy ra-full **62%** vs ra-recite **63%** (+1); scope +2; reasoning +1; reliability 0; resilience +2; tool-mastery −3.

**The smoking gun:** qwen3.5 rw-9 went from a `100→0` collapse to `98→100`. The −29pp was **100% a grading-channel artifact** — the model wrote the file (now graded → ~100), the broken grader saw only thin text (→0). Confound CONFIRMED and CLOSED.

**Recitation's true effect: NEUTRAL** (marginally positive on the local tier, within N=3/2-task noise). It does **not** clear the +3pp default-on bar → **stays opt-in** — but it is **not harmful**, so it remains a viable lever (unlike the broken-grader read which would have wrongly killed it).

**Separate finding (not recitation):** gpt-4o-mini scores **0/0 on rw-9 both arms** — the mid-tier model fails the resilience task (503 + fallback-file discovery) regardless of recitation. A real harness gap worth its own probe; it is NOT a recitation signal.

## Decision

1. **Recitation stays OPT-IN** (`RA_RECITE=1`). Increment 1 ships as an experimental, gated capability — honest, additive, zero default-path change. Correct regardless of the confound (default-on needs positive lift proof; none exists).
2. **Do NOT build the recency-placement variant yet.** The data cannot distinguish placement effects from the grading confound — spinning up variant 2 now is confirmation bias with a benchmark bill. Resolve the channel question first.
3. **The real, reusable finding is a measurement-spine gap, not a recitation result:** `llm-judge` accuracy is text-only and blind to produced files. This under-grades EVERY file-deliverable task (rw-3/rw-9 and others), independent of recitation. Worth fixing on its own — it strengthens the "honest grading" half of the spine.

### Fork (user's call — not to be spent through unilaterally)

- **(B) Fix the bench grading channel** — feed produced working-dir file contents to the judge for file-deliverable tasks, then re-run the recitation ablation honestly. Highest-value: fixes a real spine hole AND yields an interpretable recitation number. Has scope (judge payload + dispatch read tmpDir).
- **(A) Re-target the ablation** — measure recitation on postCondition-bearing tasks whose GRADED deliverable IS the text answer (e.g. required-tool tasks that answer in prose), removing the file channel. Cheaper, narrower.
- **(C) Drop recitation as a lever** — north-star predicted it helps; the honest read is "unproven + first signal not encouraging." Move to a different Pillar-8 lever. Recitation stays as opt-in dead-simple code.

The measurement spine still did its job: it refused to let an unproven mechanism ship default-on, AND the act of measuring surfaced a grading blind-spot. That is the proof engine working — it just measured the instrument as much as the change.
