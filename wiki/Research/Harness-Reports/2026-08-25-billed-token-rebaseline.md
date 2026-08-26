---
aliases: [Billed-Token Rebaseline 2026-08-25/26]
tags: [harness-report, cost-instrument, billed-tokens, rebaseline]
date: 2026-08-26
status: RESOLVED — real cache signal obtained; promotion decision routed to ablation-warden
---

# 2026-08-25/26 — Billed-Token Rebaseline (Task 9)

**Status: RESOLVED.** The live-model rebaseline called for by
[[../../Planning/Implementation-Plans/2026-08-24-cost-instrument-truth]] Task 9 initially
hit three false leads in sequence — API credit, then account-capability, then this
codebase's own stale threshold assumption — before landing on real cache data. The full
chase is recorded here because each step is the "surprising measurement indicts the
instrument first" doctrine applied to itself, and the final finding is a real, if small,
bug fix that shipped alongside this report.

## 1. The chase

**Attempt 1 — Anthropic, zero credit.** First run returned `400: Your credit balance is
too low`. Confirmed via a direct `curl` to the same key: genuinely zero balance, not a
harness defect. With the owner's explicit choice, substituted OpenAI `gpt-4o-mini` — see
§4 below for that partial result, superseded by this one.

**Attempt 2 — credit added, still zero cache activity.** After credit was added, RA's own
`disclosure-ablation.ts` still reported `cacheRead=0` on every arm on
`claude-haiku-4-5-20251001`, including `stable-surface`. This is exactly the plan's Task 9
Step 1 STOP condition ("if `cacheHitRate` is 0 on every arm... may be F10 still live"), so
it was chased rather than reported as a null result:

- Traced a live run with `.withTracing()` preserved. Tool schema list was
  **byte-identical across all 4 iterations** — `RA_STABLE_TOOL_SURFACE` genuinely
  stabilizes the tool array. The system prompt was NOT identical — one iteration injected
  a transient "give your final answer now" guidance line, then reverted on the next. A
  real, minor, separate churn bug — not yet fixed, filed below.
- But that didn't explain it either: even the *first* call (no prior conversation, no
  churn possible yet) showed `cache_creation_input_tokens: 0` on a prefix that RA's own
  code believed was well above Haiku's cache minimum.
- **Isolated it outside RA entirely.** Hand-built raw `curl` requests with explicit
  `cache_control` markers, no RA code involved, at 1,065 tokens (too small, expected),
  then 3,615 tokens (should have been well above the 2,048-token minimum RA's code
  comments claimed for Haiku) — still zero cache activity, with and without the legacy
  `anthropic-beta: prompt-caching-2024-07-31` header. This looked like an account-level
  capability gap with no code-side fix available.

**Attempt 3 — the real cause.** The user pasted Anthropic's current prompt-caching
documentation. It states **Claude Haiku 4.5's minimum cacheable prompt is 4,096 tokens**,
not 2,048. The 2,048 figure is Haiku **3.5**'s minimum (a retired model, live only on
Bedrock/Google Cloud) — carried forward into this codebase's comments as if it still
applied to Haiku 4.5. Confirmed by re-running the same raw curl construction at ~4,958
tokens: `cache_creation_input_tokens: 4958` on call 1, `cache_read_input_tokens: 4958` on
call 2. **The account was never the problem.** Every zero-cache reading this session
against Haiku was this codebase's own stale threshold, not F10, not billing.

## 2. Fix shipped alongside this report

`packages/llm-provider/src/providers/anthropic.ts` (3 sites: the `RA_TOOL_INDEX`
context-pressure comment, `buildSystemParam`'s doc comment, and the header comment above
it) and `packages/benchmarks/src/disclosure-ablation.ts`'s manipulation-check message all
said "Sonnet 1024 tok, Haiku 2048 tok". Corrected to "Sonnet 1024 tok, Haiku 4096 tok" —
verified against the current official docs and the live curl test above. Commit
`0e1597fb`.

**Still open, not fixed by this report:** the transient guidance-line injection found in
§1's trace (a genuine, separate F10-adjacent bug — the guidance channel isn't excluded
from the cacheable prefix on the iteration it fires). Filed as a follow-up, not blocking
this rebaseline.

## 3. The real measurement (anthropic/claude-sonnet-4-5-20250929, n=3)

Ran on Sonnet rather than Haiku for this final measurement — its 1,024-token minimum is
comfortably cleared by this task's ~3,500–3,800-token prefix, giving a clean read without
needing to inflate the task past Haiku's larger floor. Command:
`timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts anthropic
claude-sonnet-4-5-20250929 3 wiki/Research/Harness-Reports/raw/2026-08-26-disclosure-billed-sonnet.json`,
foreground, `--output` present. 15/15 cells succeeded, 15/15 correct. **The script's own
manipulation check did not fire** — cache reads were genuinely observed this time, not
asserted.

| arm | mean tokens | mean $USD | vs inline $ | cacheRead | correct |
|---|---:|---:|---:|---:|---|
| inline | 12,266 | $0.01400 | — | 10,136 | 3/3 |
| prune+discover | 12,279 | $0.00908 | **−35%** | 11,606 | 3/3 |
| prune-only | 11,551 | $0.01286 | −8% | 9,697 | 3/3 |
| no-prune | 14,410 | $0.01544 | +10% | 12,090 | 3/3 |
| stable-surface | 15,129 | $0.01329 | −5% | 13,491 | 3/3 |

**Billed tokens (`tokens − cacheRead`), the figure the amended gate leg scores:**

| arm | billed tokens |
|---|---:|
| inline | 2,130 |
| prune+discover | 673 |
| prune-only | 1,854 |
| no-prune | 2,320 |
| stable-surface | 1,638 |

**`stable-surface` vs `no-prune`** (the F10 comparison this program exists to answer):
raw **+5.0%** (fails a 15%-ceiling gate scored on raw only if the accuracy leg didn't
already clear it, but is directionally the "more expensive" read that produced 09 §5.3's
original verdict) vs billed **−29.4%**.

**`stable-surface` vs `inline`**: raw **+23.3%**, billed **−23.1%**, real cost **−5.1%**.

This is the exact pattern the 2026-08-24 amendment predicted and 09 §5.3 recorded under
the old rule: the arm that caches by construction reads as materially *more* expensive on
raw tokens and materially *less* expensive on billed tokens and real dollars. It is no
longer a prediction — this is a live measurement showing it.

## 4. Superseded partial result (OpenAI, kept for the record)

The original OpenAI `gpt-4o-mini` run (`wiki/Research/Harness-Reports/raw/2026-08-25-disclosure-billed-openai.json`)
is superseded by §3 above but stays in the vault: it independently proved the whole
instrument pipeline (F-1 producer → billed computation → gate → receipt) runs without
crashing end-to-end on a real provider, and its `cacheRead=0` result correctly triggered
no manipulation-check false-positive, since OpenAI's adapter genuinely reports no cache
data (a separate, now-fixed gap — see the adapter cache-surfacing commits
`e6d7aa19..fbacb35f` on this branch).

## 5. What this does NOT establish — no promotion decision made here

**`n=3` on one task shape is not statistically powered.** Per project convention (bench
cells are Bernoulli; the promotion band is 1.96σ; cross-tier sign agreement is required
across rungs 2 and 3 of the measurement ladder), this single run cannot promote
`RA_STABLE_TOOL_SURFACE` to default-on on its own — it establishes the *sign* and *rough
magnitude* of the billed-token effect, not a promotable verdict.

Per the plan's Task 9 Step 4, **the promotion decision is routed to `ablation-warden`**,
which holds the veto and must apply the promotion band and cross-tier requirement before
any default-on ruling. This report's contribution is: the billed leg now produces real,
non-degenerate numbers on a live provider, in the direction the amendment predicted, and
the instrument that measures it (Tasks 1–8, plus the adapter fixes) is independently
reviewed and verified correct.

## 6. Follow-ups filed by this investigation

1. **The guidance-line prefix churn** found in §1 (transient injection breaks a would-be
   cache hit even under `RA_STABLE_TOOL_SURFACE`) — real, separate, not yet fixed.
2. **Re-run at a larger `n`** on Sonnet (and ideally Haiku, now that its real 4,096-token
   floor is known and can be deliberately cleared) before any `ablation-warden` promotion
   pass.
3. Consider whether this codebase should migrate from Anthropic's per-block explicit
   `cache_control` breakpoints to the newer top-level automatic-caching field the current
   docs recommend as the default entry point — out of scope for this report, noted for a
   future pass.
