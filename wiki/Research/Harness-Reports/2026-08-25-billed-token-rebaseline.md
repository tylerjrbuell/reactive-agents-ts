---
aliases: [Billed-Token Rebaseline 2026-08-25]
tags: [harness-report, cost-instrument, billed-tokens, rebaseline]
date: 2026-08-25
status: PARTIAL — Anthropic run blocked, does not resolve the stable-surface question
---

# 2026-08-25 — Billed-Token Rebaseline (Task 9)

**Status: PARTIAL.** This is the live-model rebaseline called for by
[[../../Planning/Implementation-Plans/2026-08-24-cost-instrument-truth]] Task 9, run
after the cost-instrument-truth branch (`149ffcc5..b9a50a65`) landed. It confirms the
instrument works end to end on a live provider, but **does not answer the question it
was built to answer** — whether `RA_STABLE_TOOL_SURFACE` clears the amended (billed)
lift-gate leg — because the run had to move off Anthropic. Read §3 before citing any
number here as a promotion signal.

## 1. What happened

Anthropic returned `400: Your credit balance is too low to access the Anthropic API`
before any call completed — an account/billing state, not a harness defect. Per the
plan's Task 9 Step 1 STOP condition ("if `cacheHitRate` is 0 on every arm, STOP — that
may be F10 still live"), this was checked and ruled out explicitly: this is not F10,
it is zero API credit, confirmed by the 400 status and error text.

With the owner's explicit choice (asked directly, since spending real money or
substituting providers is not a call to make unilaterally), the run moved to
**OpenAI `gpt-4o-mini`**, the model this codebase's own test suite already uses as its
OpenAI reference (`packages/benchmarks/tests/m3-ablation-session.test.ts:66`).

**This substitution is why the run is partial.** `RA_STABLE_TOOL_SURFACE` and the F10
prefix-churn question are Anthropic-prompt-cache-specific mechanics. The final
whole-branch review of the cost-instrument-truth branch found (finding M1, ledgered as
correctly non-blocking) that **OpenAI's adapter never surfaces `cacheReadInputTokens`
onto `TokenUsage` at all** — `packages/llm-provider/src/providers/openai.ts:610,970`
use `cached_tokens` for pricing only, never populate the field the billed-token leg
reads. So `cacheRead === 0` on every OpenAI arm below is not a measurement — it is a
known, unconditional property of running this ablation on OpenAI. `billedTokens`
therefore equals `tokens` (raw) on every row. The billed and raw legs cannot diverge
on this data, by construction, so this run cannot distinguish them.

## 2. What this run DOES establish

Despite the above, the run is not worthless — it is the first live proof that the
whole W1+W2 pipeline (F-1 producer → billed-token computation → gate → receipt) runs
without crashing on a real provider, real tool calls, and a real multi-step task:

- `check(disclosure-ablation.ts)`'s built-in **manipulation check fired correctly**:
  `MANIPULATION CHECK FAILED: stable-surface reported cacheRead=0 ... Do NOT read a
  cost conclusion off this run.` The script's own honesty guard did exactly what it
  was written to do — this was not silently swallowed.
- All 15 cells (5 arms × n=3) completed without error: **15/15 `success` /
  `end_turn`, 15/15 `correct` (wrote the right file, graded on disk)**.
- Command: `timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts openai
  gpt-4o-mini 3 wiki/Research/Harness-Reports/raw/2026-08-25-disclosure-billed-openai.json`
  — run in the foreground, `--output` required and present, per project convention
  (background bench cells get SIGKILLed silently).
- Raw cell data: `wiki/Research/Harness-Reports/raw/2026-08-25-disclosure-billed-openai.json`.

## 3. Results (openai/gpt-4o-mini, n=3)

| arm | mean tokens (raw = billed) | mean $USD | cacheRead | correct |
|---|---:|---:|---:|---|
| inline | 7,612 | $0.00076 | 0 | 3/3 |
| prune+discover | 7,612 | $0.00071 | 0 | 3/3 |
| prune-only | 7,086 | $0.00079 | 0 | 3/3 |
| no-prune | 9,099 | $0.00094 | 0 | 3/3 |
| stable-surface | 9,630 | $0.00085 | 0 | 3/3 |

vs `no-prune` baseline (the F10 comparison this program cares about):
`stable-surface` = **+5.8% tokens, −9.6% cost.** Both legs read identical
(`billedTokenOverheadPct == tokenOverheadPct == +5.8%`) because `cacheRead` is
structurally 0 for this provider — **this agreement is not evidence the legs behave
the same on a caching provider; it is an artifact of OpenAI reporting no cache data
at all.**

**Accuracy leg: uninformative.** n=3, every arm 3/3. Per project convention (bench
cells are Bernoulli, 5 tasks × n≤5 carries ~13pp standard error), a task this small
and this easy (one file, one deterministic sum) sits at a ceiling and cannot
distinguish arms on accuracy. This was expected going in — the task exists to
measure token/cost shape, not accuracy, and the report does not claim otherwise.

## 4. What is still open

**The actual promotion question — does `RA_STABLE_TOOL_SURFACE` clear the amended
billed-token lift-gate leg — is unanswered.** It requires a real cache hit, which
requires:
1. Anthropic API credit (the account used for this session has none), and
2. a system prompt at or above the per-model cache minimum (Sonnet 1,024 tokens,
   Haiku 2,048 tokens — `disclosure-ablation.ts`'s own manipulation-check comment).

Per the plan's Task 9 Step 4, **no promotion decision is made here.** This report
routes the eventual decision to `ablation-warden`, which holds the veto and applies
the promotion band (1.96σ) and the cross-tier sign-agreement requirement (rungs 2 and
3). Nothing in this report should be read as promoting or rejecting
`RA_STABLE_TOOL_SURFACE`.

## 5. Next step

Re-run `disclosure-ablation.ts anthropic claude-haiku-4-5-20251001` (or `sonnet`, per
the measurement ladder) once Anthropic credit is restored. That run is what actually
resolves the question this task exists to answer — this OpenAI run was a substitution
made explicit and disclosed, not a replacement for it.
