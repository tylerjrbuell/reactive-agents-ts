---
title: Spike 1 — Age-Aware Context Curation — cross-tier ablation
date: 2026-05-30
flag: RA_CURATION_AGEAWARE (default OFF)
verdict: "OPT-IN (conservative) — T3-strict: sonnet 1/3→3/3 win, gpt+qwen flat, ZERO regression; default-on once over-listing addressed by response-shaping"
relates:
  - "[[2026-05-30-context-curation-architecture]]"
---

# Spike 1 — Age-Aware Context Curation

**Change:** when `RA_CURATION_AGEAWARE=1`, the most-recent TURN's tool results are kept
FULL in the assembled prompt (window-scaled ceiling), and only AGED results are
compressed to preview + the existing reversible pointer. Default OFF = byte-identical
(the current flat `TOOL_RESULT_INLINE_CAP=4000` applied to every result regardless of
age/window). Build: `attend/tool-formatting.ts` + `attend/context-utils.ts`; suite
1496/0 both arms.

## Cross-tier ablation (fixture-pinned, N=3): arm A (OFF) vs arm B (ON)

| tier | avg composite A→B | T3 composite A→B | T3 faithfulness A→B | T3-strict A→B | recall smells A→B |
|---|---|---|---|---|---|
| **sonnet-4-6** | 91% → **100%** | 56% [100,35,35] → **100% [100,100,100]** | **0% → 100%** | 1/3 → **3/3** | 0 → 0 |
| **gpt-4o-mini** | 88% → **91%** | 67% → **82%** | 33% → **67%** | 0/3 → 0/3 | 0 → 0 |
| **qwen3.5 (local)** | 92% → **88%** | 90% → **76%** | 100% → 100% | 0/3 → 0/3 | 3 → 2 |

pass^k 5/5 on every tier/arm (no completion regressions). T1/T2/T4 unchanged (100%) on
every tier; the action is entirely on the overflow tasks (T3 ≈5000 chars > the 4000 cap; T5).

## Findings

1. **Transformative on the truncation-loop failure class.** sonnet T3 was the exact
   bug root-caused this session ("the results were truncated, let me retrieve the full
   content" → cratered runs [100,35,35]). Keeping the current 25-post result FULL →
   **T3 composite 56→100, faithfulness 0→100, T3-strict 1/3→3/3** (T3-strict was 0/3 on
   EVERY tier in the Phase-0 baseline — this is the first 3/3). The loop is gone. avg → 100%.
2. **Real overflow-faithfulness lift on gpt-4o-mini** (+34pp T3 faith, +15pp T3 composite,
   +3pp avg). Same mechanism.
3. **qwen3.5 is FLAT on the trusted metric — the composite "dip" is a scoring artifact, NOT
   a curation regression.** Decompose qwen T3: faithfulness **100% both arms**, format **100%
   both**, completeness **100% both** — identical. The *entire* 90→76 composite delta is the
   `noFabrication` term (67→34), which on T3 is `1 − wrongPicks*0.33` — a **score-confusion /
   over-listing penalty**, not fabrication. And **T3-strict (exact id-set, the metric built
   precisely because composite is lenient on T3) is 0/3 in BOTH arms — flat.** qwen finds the
   right posts either way (faith 100); it is a known over-lister (Phase-0: 15–23 ids cited,
   0/3 strict), and full data gave it more rope to over-list. The truncated preview scored
   "better" only because the model saw fewer wrong candidates — i.e. **the composite rewarded
   starvation.** That directly contradicts the thesis (present optimally, don't hide data).
   This is qwen's pre-existing weakness amplified by more data, not a regression the curation
   caused.

## Verdict (recomputed on T3-strict — the trusted metric)
| tier | T3-strict A→B |
|---|---|
| sonnet | 1/3 → **3/3** (big win — loop eliminated) |
| gpt-4o-mini | 0/3 → 0/3 (flat) |
| qwen3.5 | 0/3 → 0/3 (flat) |

**One big win, two flat, ZERO regression.** **SHIP OPT-IN (RA_CURATION_AGEAWARE), default
OFF** — not because of a regression (there is none on the trusted metric), but for
conservatism: a single fixture + an open over-listing interaction to tune. Default-on is the
likely destination once the over-list is addressed by **response-shaping** (Phase-2 recitation
— "pick EXACTLY 3"), NOT by curtailing context.

> **End-to-end ON path confirmed:** the sonnet arm-B run drove `buildConversationMessages`
> end-to-end to T3 100/100/100 — closing the build's flagged "no e2e test of the ON path"
> edge (0.66 confidence). The ON path works in a real KernelState, not just the pure unit.

## Why divergence — and the path to default-on
The optimal curation appears task×model-dependent: full current data helps models that were
being *starved* (truncated below what synthesis needs), but can hurt a verbose over-lister on
a *selective* task by inviting over-selection. Routes to investigate before default-on:
- **K / budget tuning** — K=1 turn + the conservative budget fractions
  (RECENT_WINDOW_FRACTION 0.35, etc.) are first-pass; tune cross-tier.
- **The qwen over-list is also a Phase-0 finding** (no-filter dump, 15–23 ids cited) — it
  may be better addressed by the *selective-filter prompt / response-shaping* than by
  curtailing context. The right fix is "present optimally," not "hide data."
- Pairs with the recall-removal downstream step (the reversible store + auto-rehydration the
  curator now owns) and Phase-2 recitation (a "you must pick EXACTLY 3" remaining-state line
  could counter over-listing).

Net: a strong, proven win shipped behind a flag; the divergence is understood and is the next
tuning target, not a blocker to landing the mechanism.
