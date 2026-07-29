# Rung 2 — haiku composite (2026-07-28)

Live measurement via `packages/benchmarks/src/disclosure-ablation.ts`, provider
`anthropic`, model `claude-haiku-4-5-20251001`, **n=3** (full 3 runs completed,
no truncation — 5 arms × 3 runs = 15/15 live cells). Raw per-cell data is
persisted at `2026-07-28-rung2-haiku-composite.json`; this file is the
human-readable summary.

## Manipulation check: PASSED (did not fire)

`stable-surface` reported non-zero `cacheRead` on all 3 runs
(4469 / 26380 / 17435 — mean 16095), so the script's
`MANIPULATION CHECK FAILED` guard did not trigger. The prefix is caching
correctly at this task size; no diagnosis needed.

## Two kinds of figure in this table — read the caveat before the numbers

**Accuracy is reported with n=3 and carries roughly ±26pp of standard error**
per the project's own bench-interpretation rule (5 tasks × n≤5 → ~13pp SE per
data point; combining two arms roughly doubles that to ~26pp for a
difference). Every arm below hit `3/3 correct` — a tie at this n, which is
itself informative (no arm broke the deliverable) but **is not evidence that
any two arms differ in accuracy.** Do not read the flat `3/3` row as "all arms
equally good" beyond that — it is "no arm failed in 3 tries," a much weaker
claim.

**Cost and cache figures are near-deterministic and can be read at this n
without the same caveat.** Token counts, `$USD`, and `cacheRead` are direct
measurements of what the API billed for a fixed, scripted task — they are not
sampled from a noisy pass/fail distribution, so n=3 is enough to trust the
relative ordering between arms. These two categories should not be conflated:
a confident cost finding does not imply a confident accuracy finding at this
same n.

## Arm table (mean of n=3)

| arm | tokens | cost (mean) | vs inline | cacheRead | freshIn | correct |
|---|---:|---:|---:|---:|---:|---:|
| inline | 13,998 | $0.01529 | — (baseline) | 0 | 13,674 | 3/3 ± ~26pp |
| prune+discover | 33,752 | $0.03916 | +156% | 0 | 32,399 | 3/3 ± ~26pp |
| prune-only | 31,791 | $0.03745 | +145% | 0 | 30,375 | 3/3 ± ~26pp |
| no-prune | 45,004 | $0.03996 | +161% | 14,085 | 16,966 | 3/3 ± ~26pp |
| stable-surface | 44,995 | $0.03745 | +145% | 16,095 | 17,522 | 3/3 ± ~26pp |

(`vs inline` is the mean-cost delta against the `inline` arm's mean cost,
matching the script's own console table.)

## Reading the cost/cache figures (high confidence at this n)

- **`prune-only` vs `prune+discover`** (the F3 question): near-identical
  tokens (31,791 vs 33,752) and cost (\$0.03745 vs \$0.03916), same 3/3
  deliverable. On this task shape the `discover-tools` escape hatch is not
  buying anything measurable — pruning alone reaches the same result at
  roughly the same cost.
- **`no-prune` vs `stable-surface`**: near-identical total tokens (45,004 vs
  44,995) but `stable-surface` shows the intended cache effect at cost parity
  with the cheapest kernel arms (\$0.03745, tied with `prune-only`) while
  `no-prune` is the most expensive arm on cost (\$0.03996) despite also
  caching (14,085 mean cacheRead) — its cached prefix is smaller relative to
  its fresh-input tokens (16,966 freshIn vs stable-surface's 17,522, but
  no-prune's total token count is inflated by a standing frame that is not
  itself part of the cached block; see the ARMS comment in
  `disclosure-ablation.ts` for why `no-prune` only caches incidentally).
- **`inline` remains cheapest in absolute terms** (\$0.01529, 13,998 tokens):
  it does no pruning, no discovery, and no kernel overhead at all, so it is
  the cost floor by construction, not a finding about the kernel arms'
  relative merits.
- All kernel arms (`prune+discover`, `prune-only`, `no-prune`,
  `stable-surface`) cost roughly 145–161% more than `inline` in absolute
  dollars at this small, 3-tool task — the kernel's per-call overhead is the
  dominant cost driver here, not disclosure pruning specifically.

## What this rung does and does not establish

- Establishes (high confidence, cost/cache are near-deterministic at n=3):
  `discover-tools` bought nothing measurable on this task shape;
  `stable-surface` caches correctly at haiku's 2048-token minimum and reaches
  cost parity with the cheapest kernel arm while adding the intended caching
  behavior that `no-prune` does not get for free.
- Does NOT establish (would need larger n): any accuracy ranking between
  arms — all five tied at 3/3 in this run, which bounds nothing below ~26pp.
