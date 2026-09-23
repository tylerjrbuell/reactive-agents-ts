---
date: 2026-09-23
type: measurement
status: complete
related:
  - "[[Implementation-Plans/2026-09-20-typesafe-judgment-layer]]"
  - "[[Research/Debriefs/2026-09-22-jev-judge-eval-overhaul-debrief]]"
  - "[[Hot]]"
---

# Judgment Layer Methodology Gate — `judgeEngine: "llm"` vs `"jev"` (Task 6 Step 5)

Real live-API run, both engines against the same frozen, hand-labeled dataset. This is the gate the
plan's POC section flagged as "recommended next step, separate from further coding" — a larger,
RA-domain-real comparison beyond the POC's 10 synthetic relevance pairs.

## Method

16 hand-labeled cases, 4 per `@reactive-agents/eval` dimension (accuracy/relevance/completeness/
safety), 2 clear-cut "good" + 2 clear-cut "bad" per dimension so ground truth is unambiguous (same
spirit as the plan's POC). Zero SUT cost: every case's `actualOutput` is a fixed canned string, so
Rule 4 isolation (00-RESEARCH-DISCIPLINE.md) is trivially satisfied — there is no live SUT call to
share a code path with. Judge: `"llm"` engine = the original per-dimension `parseFloat`-scored path
against a frozen `claude-haiku-4-5-20251001` `JudgeLLMService`; `"jev"` engine = one batched Score
request per case against `@typesafe-ai/sdk`'s `jev-latest`. `repeats: 5` per case per engine (measures
judge variance on the identical fixed output, not SUT variance). `parallelism: 1` (see harness-bug
note below).

Scoring script (not committed — ad hoc measurement run, real API calls against both `TYPESAFE_API_KEY`
and `ANTHROPIC_API_KEY`).

## A harness bug caught before any result could be trusted

The first run showed the `completeness` dimension scoring good and bad answers **identically** —
`0.33` for both a complete and an obviously-incomplete answer to "List the three primary colors,"
reproduced on **both** engines. Per the project's own discipline ("a surprising measurement indicts
the instrument first"), this was investigated before drawing any conclusion about the judge. Root
cause: two labeled cases (`comp-good-1`/`comp-bad-1`) deliberately reused the *same* input text with
different `actualOutput` (to isolate the judge's sensitivity to output quality alone, holding the
question fixed) — but the canned SUT runner was keyed by `Map<input, output>`, so the second case's
entry silently overwrote the first's, and **both cases were scored against the same actualOutput**.
Confirmed by grep: only `completeness` had colliding input strings; every other dimension used unique
inputs per case and discriminated fine even before the fix. Fixed by switching to an order-matched
queue (`parallelism: 1` to guarantee deterministic case-processing order) instead of an input-keyed
map. Re-ran; completeness then discriminated correctly on both engines (see results below). This was
a bug in the measurement script, not in `@reactive-agents/eval` or `@reactive-agents/judgment`.

## Results (post-fix, real numbers)

| Metric | `llm` engine (haiku, parseFloat) | `jev` engine (TypeSafe) |
|---|---|---|
| Classification accuracy (score ≥ 0.5 vs ground truth, n=16) | 87.5% (14/16) | **100% (16/16)** |
| Pearson r (predicted score vs ground truth) | 0.947 | 0.965 |
| Avg within-case stddev (5 repeats, same fixed output) | 0.0028 | 0.0030 |
| Avg latency per case | 2663 ms | **1136 ms** (2.3× faster) |
| Parse degrades | n/a (`\|\| 0.5` fallback never observed) | n/a (typed, no parsing at all) |

Per-case predicted scores (both engines, 16 cases): the two llm-engine misses were `acc-bad-1`
("chemical symbol for gold" → wrong answer "Ag") scored `0.50` (ambiguous, should be near 0) and
`relevance/rel-bad-2` (completely off-topic answer) scored `0.50` (ambiguous, should be near 0). `jev`
scored both of these correctly near 0 (`0.00` and `0.42` respectively — `rel-bad-1`, the harder
off-topic-but-mentions-the-right-country case, was the one softer call either engine made, both
landing in the 0.4-0.5 uncertain band, which is a reasonable place for a genuinely ambiguous case to
land).

## Divergence from the POC's claims — reported honestly, not smoothed over

- **Variance parity, not a 5× jev advantage.** The plan's POC section reports jev at ~5× lower
  within-pair stddev than the LLM judge. This run found near-parity (0.0028 vs 0.0030). Cause: the
  classic `llm`-engine dimension scorers (`dimensions/*.ts`) call the judge at `temperature: 0.0`
  explicitly — already near-deterministic — whereas the POC's relevance-only setup evidently sampled
  with more variance. This is a real, useful correction to the plan's headline numbers, not a
  contradiction to hide: **the "5× steadier" claim does not generalize across all four dimensions at
  `temperature: 0`,** and any future claim citing that POC number should scope it to the conditions
  it was measured under.
- **Cost not captured by this method.** `EvalResult.costUsd` only accumulates SUT cost (`0` here, by
  design — canned outputs), not judge inference cost; neither engine's per-call token/dollar cost was
  captured by this harness path. The POC's own unit economics (`jev` $0.042/MTok in, free out; haiku
  $1.00/$5.00 per MTok) remain the authoritative cost baseline — this report doesn't re-derive it and
  a reader should not assume `$0` is a real cost result.
- **Latency directionally consistent.** 2.3× faster here vs the POC's 2.8× — same direction, similar
  magnitude, on a genuinely different (larger, 4-dimension) dataset. This one *does* corroborate the
  POC.

## Verdict

**Confirms the Task 3 default (`judgeEngine: "jev"`).** On this frozen, RA-domain-real, unambiguously
labeled 16-case set: jev matches or exceeds the LLM-judge path on every accuracy metric (100% vs 87.5%
classification accuracy, higher Pearson correlation to ground truth), is meaningfully faster, and
introduces zero parsing failure modes (typed answers vs `parseFloat` on free text). The variance claim
in the plan's POC section should be read as scoped to that POC's specific (temperature-unspecified,
relevance-only) setup, not as a general 5× guarantee across every dimension.

## Limitations (say so, don't inflate the sample)

- n=16 is small. Every case was designed to be unambiguous by construction (2 clear "good" + 2 clear
  "bad" per dimension) — this measures whether the judge gets *easy, clear-cut* calls right, not its
  behavior on genuinely borderline cases (the one soft call either engine made, `rel-bad-1`, hints at
  where that would matter).
- No cost comparison was produced by this run (see above) — cite the POC's unit economics instead.
- This gate validates the **eval-judge** use of `JudgmentService` (Phase B). It says nothing new about
  the Phase C runtime shadow sites' agreement rates — those are separate, still-open exit gates.
