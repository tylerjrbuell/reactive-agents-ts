---
aliases: [Stable Surface Promotion Verdict]
tags: [harness-report, ablation, stable-tool-surface, verdict]
date: 2026-08-30
status: RESOLVED — REMOVE
---

# 2026-08-27/30 — Stable Tool Surface Promotion Verdict

**Status: RESOLVED. Verdict: REMOVE `RA_STABLE_TOOL_SURFACE`.**

Dispatched 2026-08-27 to re-earn the `RA_STABLE_TOOL_SURFACE` verdict under the
corrected billed-token lift-gate leg (2026-08-24 amendment). The dispatched
`ablation-warden` run produced two complete raw data blocks
(`raw/2026-08-27-stable-surface-sonnet-b1.json`,
`raw/2026-08-27-stable-surface-sonnet-b2.json`, n=10 each, Sonnet) but never
delivered its analysis report before the session moved on. This document
computes the verdict directly from that raw data — no new API spend required.

## Result (n=20, `anthropic/claude-sonnet-4-5-20250929`)

| arm | mean tokens | mean billed | mean cache-read | mean $USD | correct |
|---|---:|---:|---:|---:|---:|
| inline | 12,265 | 513 | 11,751 | 0.00868 | 20/20 |
| **prune+discover (shipped default)** | 12,259 | **347** | 11,912 | 0.00808 | 20/20 |
| prune-only | 11,553 | 525 | 11,027 | 0.00858 | 20/20 |
| no-prune | 14,415 | 568 | 13,848 | 0.00966 | 20/20 |
| **stable-surface (candidate)** | 15,113 | **578** | 14,534 | 0.00976 | 20/20 |

**Billed-token overhead, stable-surface vs the shipped default (`prune+discover`): +66.5%.**
Over 4x the §2 15% ceiling.

## Why this differs from the earlier n=3 read

The 2026-08-26 n=3 reading (billed −29.4%) compared `stable-surface` against
`no-prune`, which is not the shipped default. Against the actual default in
that same run, `stable-surface` already read worse on cost
($0.01329 vs $0.00908). This run fixes the base per the mission brief's
Ruling 1 (base = the shipped default, since the promotion question is
"should the default change") and confirms that direction at 6.7x the sample
size.

## The accuracy leg — the harder blocker

Every arm scored 20/20 on this task (read/compute/write, graded on disk). The
task is saturated. §2's rule is **≥3pp accuracy lift AND ≤15% billed
overhead** — with accuracy flat across every arm, the lift leg cannot be
satisfied on this task shape **no matter what the cost number says**. This is
not reinterpreted to fit a result; it forecloses default-on before the cost
number is even relevant.

## Confounds checked

- **Haiku tier was never run** (no `*-haiku-*.json` files exist from this
  dispatch). Technically leaves the two-tier cross-agreement requirement
  unmet. Not chased further: the Sonnet signal already fails the ceiling by
  ~4.4x, and `stable-surface` costs the *most* raw tokens of any arm on both
  known runs — a second tier is very unlikely to flip a 4x miss.
- **Cache mechanism works as designed.** `stable-surface` has the highest
  cache-read of any arm (14,534). The mechanism is not broken — it just can't
  outrun the cost of holding the full permitted tool surface visible every
  iteration on this task shape.

## Ruling

**REMOVE, not keep-opt-in.** `stable-surface` is not merely failing to earn
promotion — it costs *more* billed tokens than the shipped default it would
replace, on the one axis (money) it exists to win. An opt-in flag that
underperforms the default it's an alternative to is not a hedge worth
keeping in the tree. Delete `RA_STABLE_TOOL_SURFACE`, its resolver in
`harness-flags.ts`, its `HarnessConfig.stableToolSurface` field, and the
`stable-surface` arm in `disclosure-ablation.ts`.

Filed as a follow-up task, not executed here — this document is the
measurement, not the deletion.
