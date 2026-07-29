---
tags: [decision, proposal, lift-rule, 09-unified-program, F10, caching]
date: 2026-07-29
status: PROPOSED — awaiting owner ratification. NOT in force.
proposes-amendment-to: wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §6 (lift rule)
evidence: wiki/Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline.md
---

# PROPOSAL: the §6 lift rule cannot express "costs less money at more tokens"

> [!warning] This is a PROPOSAL, not a rule change.
> **§6 is not edited by this document and is not amended by this document.** The
> rule in force today is unchanged: **≥3pp accuracy lift AND ≤15% token overhead**,
> cross-tier. Under that rule, `RA_STABLE_TOOL_SURFACE` **FAILED** and stays
> opt-in — that verdict is already recorded in
> [[../Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline]] and in
> 09 §7, and it does **not** depend on this proposal being accepted.
>
> Ratifying this would change what the codebase is permitted to promote to
> default-on, which per 09 §5's conflict rule is an owner ratification event, not
> an edit-in-passing. Hence a decision document rather than a diff.

## 1. Why this is filed as a rule defect and not as an appeal

The immediate trigger is a mechanism that failed the rule. That is exactly the
situation in which "the rule really meant something else" is most tempting and
least trustworthy, so the order of operations matters and is stated plainly:

1. `RA_STABLE_TOOL_SURFACE` was scored against §6 **as literally written**.
2. It **failed** on the token leg by 2.2×–6.1× on every tier.
3. It **stays opt-in**. No promotion. No code change to `harness-flags.ts`.
4. *Separately*, and only after that verdict was fixed, this document argues the
   rule has a blind spot that the same measurement happens to expose.

This project has a named failure mode for the alternative — hitting a target by
redefining it (`feedback_no_metric_gaming_refactor`). The defence against it is
not to avoid ever amending a rule; it is to **let the rule bite first, record the
loss, and argue the amendment on its own merits afterwards**. If this proposal is
rejected, nothing changes and the verdict stands. If it is ratified, the
mechanism still has to clear the accuracy leg, which it currently does not.

## 2. The measurement that exposes the gap

From [[../Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline]],
rung 2 (haiku, n=3, all 15 cells delivered), candidate `stable-surface` against
the shipped default `prune+discover`:

| | baseline `prune+discover` | candidate `stable-surface` | delta |
|---|---:|---:|---:|
| tokens | 33,752 | 44,995 | **+33.3%** |
| cost | $0.03916 | $0.03745 | **−4.4%** |
| cacheRead | 0 | 16,095 | — |

And the sharpest form of the same fact, between two arms with **identical token
counts**:

| arm | tokens | cost |
|---|---:|---:|
| `no-prune` | 45,004 | $0.03996 |
| `stable-surface` | 44,995 | $0.03745 |

**Nine tokens apart. 6.3% apart in money.** The entire difference is cache
utilisation. A token-denominated rule is structurally blind to it — not
imprecise, *blind*: the two arms are indistinguishable on the axis the rule
measures, and materially different on the axis the user pays.

## 3. The rule has no concept of money at all — verified, not asserted

Read `packages/benchmarks/src/gate/` before writing this section. The finding is
stronger than "the rule prefers tokens":

- `gate/types.ts:100-101` — the policy is `{ minLiftPp: 3, maxTokenOverheadPct: 15 }`.
- `gate/gate.ts:208` — `tokenOverheadPct = (candTokens − baseTokens) / baseTokens × 100`.
- `gate/gate.ts:286` — `costOk = tokenOverheadPct <= policy.maxTokenOverheadPct`.
  The variable is *named* `costOk` and is computed **entirely from token counts**.
- `gate/gate.ts:277-284` — the one existing exemption, `long-horizon`, replaces
  the ceiling with cost-per-verified-deliverable — which is
  **`candTokens ÷ pass-rate`**, i.e. also tokens.
- `gate/types.ts` — **no `costUsd`, no price, no cache field exists anywhere in
  `TierEvidence`, `LiftPolicy`, or `GateVerdict`.** There is no input through
  which a dollar figure could reach the gate even if someone wanted it to.

So the rule does not weigh tokens over money. **It has never been able to see
money.** When it was written, `tokens × price` was a constant multiple and the
distinction did not exist, so nothing was lost by conflating them.

## 4. Why the conflation stopped being true

Anthropic (and now most major providers) discount a prompt-cache read by roughly
**90%**. A cached input token and a fresh input token are the same unit to a
token counter and differ by an order of magnitude on the invoice. Any mechanism
whose value is *prefix stability* — which is the entire class F10 belongs to —
therefore shows up on the token axis as **pure cost with none of the benefit**.

This is not a corner case. It is the dominant optimisation available to a
long-running agentic harness, and the rule as written **systematically rejects
the whole class**, regardless of how much money it saves. That is a false
negative built into the instrument, and this project's standing lesson is that a
surprising measurement indicts the instrument first
(`feedback_instrument_before_conclusion`).

Note also what the rule gets *right* and must keep: a token ceiling is a
context-window and latency guard as much as a cost guard, and it is the reason
the harness has not accreted unbounded prompt bulk. **The proposal below does not
remove it.**

## 5. Proposed amendment (text for owner consideration)

Add to 09 §6, replacing nothing:

> **Cost leg (amended 2026-07-__).** A candidate clears the cost half of the lift
> rule if **either**:
>
> - **(a) token overhead ≤ 15%** — the original bar, unchanged; **or**
> - **(b) billed cost overhead ≤ 0%** *and* token overhead ≤ 100%.
>
> Leg (b) exists because prompt caching decoupled tokens from money: a provider
> discounting a cache read ~90% makes "more tokens, less money" a real and
> desirable outcome that leg (a) scores as a regression. Leg (b) is deliberately
> harder than leg (a) on its own axis — it demands cost **parity or better**
> against the baseline, not a 15% allowance — because a rule that admits a new
> currency must not also relax the bar in that currency.
>
> The `≤ 100%` token guard on leg (b) is not a cost control; it is a **context
> and latency** control. Tokens still occupy the window and still cost wall-clock
> time. Leg (b) may not be used to justify unbounded prompt growth that happens
> to be cheap.
>
> **Leg (b) requires a cost measurement to exist.** Rungs with no billing
> (local/Ollama) cannot satisfy it, cannot be averaged into it, and cannot be
> cited as agreement on it. A candidate invoking leg (b) needs **≥1 billed tier**
> and still needs the cross-tier accuracy agreement the rule already requires.
>
> **Anti-gaming clause.** A candidate may not invoke leg (b) on a run whose
> `cacheRead` is zero. Cost parity without cache utilisation means the saving
> came from somewhere else and must be explained on its own terms, not laundered
> through this leg. The `disclosure-ablation` manipulation check already enforces
> the analogous condition for caching claims.
>
> The accuracy leg (**≥3pp, cross-tier**) is **unchanged** and remains an AND, not
> an OR. Nothing in this amendment lets a mechanism reach default-on on cost alone.

### Implementation, if ratified

Non-trivial and deliberately out of scope for this document:

- `GateResultRow`/`TierEvidence` need a billed-cost field, and the benchmark
  harnesses need to populate it. `disclosure-ablation.ts` already records
  `costUsd`, `cacheRead` and `freshIn` per cell; most others do not.
- `LiftPolicy` gains `maxCostOverheadPct` (0) and `maxTokensUnderCostLeg` (100).
- `gate.ts:286`'s `costOk` becomes the disjunction, with a `costMeasured` guard so
  unbilled tiers fall through to leg (a) rather than silently passing leg (b).
- `formatGateReceipt` must print **which leg** a verdict cleared. A receipt that
  hides the leg reintroduces the ambiguity this amendment exists to remove.
- A red-on-cut gate test per the standing "no script → not done" invariant.

## 6. What ratifying this would and would not do

**Would:** make the instrument capable of expressing a cost win, which it
currently cannot, on the one optimisation class most available to this harness.

**Would not:** promote `RA_STABLE_TOOL_SURFACE`. Under the amended rule it clears
leg (b) at haiku (−4.4% cost, +33.3% tokens, cacheRead 16,095 — inside the 100%
token guard, non-zero cache) but **still fails the accuracy leg**, which is unmet
cross-tier because rung 2 is at ceiling and measures 0pp. It would move from
"fails on cost" to "fails on accuracy," and would need a rung-2 task shape with
accuracy headroom before it could be reconsidered. **Ratifying this proposal
promotes nothing.**

**Would not:** retroactively re-score any prior measurement. The six earlier
lift failures failed on accuracy, tokens, or both, and none of them was a caching
mechanism.

## 7. Recommendation

Ratify, **after** the accuracy-headroom gap in the rung-2 bench is fixed — the
two are entangled. As long as the composite bench runs one task that haiku solves
3/3 on every arm, the billed tier can measure cost and cannot measure accuracy,
so a cost-aware rule would be operating with half its inputs dead on the only
rung that can supply the other half. Fixing the bench first makes the amended
rule testable on real candidates instead of on this one.

Until ratification: **§6 stands as written, `RA_STABLE_TOOL_SURFACE` stays
opt-in, and no document may describe the lift rule as cost-aware.**
