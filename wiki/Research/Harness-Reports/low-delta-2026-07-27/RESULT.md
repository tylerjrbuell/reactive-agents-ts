# low_delta_guard evidence-delta reset — lift measurement

**Date:** 2026-07-27 · **Task:** rw-7 · **Arms:** `low-delta-legacy` vs `low-delta-evidence`
**Raw cell reports:** `*.json` in this directory · **Session:** `low-delta-ablation`

## Verdict

**Default-on is justified for rw-7's task class.** The lift rule (09 §6: ≥3pp lift AND
≤15% token overhead) passes on the tier where the mechanism activates, and the mechanism is
provably *inert* — not merely harmless — on the tier where it does not.

| tier | guard fires (legacy) | accuracy legacy → evidence | tokens | verdict |
|---|---|---|---|---|
| `claude-haiku-4-5` | **11/12 runs** | **0.000 → 0.417** (+41.7pp) | +8.6% | **PASS both halves** |
| `gpt-4o-mini` | **0/4 runs** | 0.67 → 0.67 (no change) | see note | mechanism never ran |

Significance on the tier that matters: exact permutation test on graded accuracy,
**p = 0.00002** (n=12 per arm, 200k permutations). Every one of the twelve legacy runs
scored exactly 0.000; eleven of twelve evidence runs scored above 0.

## What the reset actually does

The misfire reproduced on the very first haiku chunk and never stopped:

```
LOW_DELTA FIRE  tokenDelta=187  consecutiveLowDeltaCount=2  artifactsAvailable=4
LOW_DELTA FIRE  tokenDelta=182  consecutiveLowDeltaCount=2  artifactsAvailable=4
LOW_DELTA FIRE  tokenDelta=181  consecutiveLowDeltaCount=2  artifactsAvailable=5
```

Runs killed while holding 4–5 artifacts, `tokenDelta` ~185 — the rw-7 signature from the
original traces (`tokenDelta: 188`). The guard measures token delta, which is ~0 exactly
when a model emits short tool calls against large results.

## Two findings that contradict what we expected

**1. The guard-fire rate is the WRONG primary signal.** This session's own header told the
reader to read it first and to ignore the accuracy comparison if the rate did not drop. The
rate barely moved — 11/12 → 7/12, Fisher two-tailed **p = 0.155**, not significant — while
accuracy went 0.000 → 0.417 at p = 0.00002. The reset does not mainly *prevent* the fire; it
*delays* it, so the run gets its work done first. Guidance corrected in the session file.

**2. The tier-2 "token overhead" was noise, and nearly became a false negative.** The first
reading was legacy 17702 vs evidence 22248 tokens = **+25.7%**, which would have failed the
lift rule and blocked promotion. But the guard fired **zero** times in the evidence arm, so
the mechanism could not have caused it. Re-running the *legacy* arm gave **20217** tokens for
the identical configuration — a 14% swing within one arm, comparable to the "overhead" being
attributed to the mechanism. Confirmed by measuring legacy's fire rate: **0/4**. The
mechanism never executes on gpt-4o-mini, so tier 2 supplies no evidence for or against it —
only the safety property that it costs nothing where it is not needed.

Had the legacy fire rate not been re-measured, this would have been written up as "fails the
token ceiling on a second tier" and the promotion would have been wrongly refused.

## Scope and limits — read before generalising

- **One task.** rw-7 only. The lift rule is per-task-class, so this qualifies rw-7's class:
  long-horizon multi-file debug with **no declared file deliverable**. rw-4 is explicitly
  *not* in scope — it is already shielded by the unproduced-deliverable rule (confirmed live
  2026-07-27: 34 iterations, 12 tool calls, guard never fired).
- **n=12 per arm on haiku, n=4–6 on gpt-4o-mini.** Adequate for the effect observed
  (p=0.00002); not adequate to resolve a small effect, and not intended to.
- **The local tier cannot measure this at all.** qwen3:4b and qwen3:14b both emit long
  per-iteration reasoning, so `tokenDelta` never approaches the 500 threshold and the guard
  fires zero times. Three void local arm-sets are recorded in DEBT-REGISTER; do not repeat
  them.
- **Accuracy here is graded, not binary.** Ten of the twelve evidence runs scored 0.33 and
  two scored 1.0. `solved` (accuracy ≥ 1) is 2/12 vs 0/12, Fisher p=0.478 — near-floor on
  both arms and underpowered by construction. The graded score is the honest measure.

## Recommendation

Promote the evidence-delta reset to default-on for the rw-7 class, or — the more conservative
option and the one that needs no new judgement — make it unconditional, since it is a
measured no-op wherever the guard does not fire.

The decision remains owner-gated and ablation-warden-vetoable per 09 §6. What has changed is
that it is no longer unmeasured.
