---
type: experiment
status: resolved (results in S3.md, S4.md; scorecards at the end of each)
created: 2026-11-18
tags: [measurement, spike, s3, s4, gate-v2, trigger-census, predictions]
---

# Predictions: spikes S3 (retrospective validation of gate v2) and S4 (trigger census)

Written before any analysis script ran. Zero tokens, no live model. Inputs: `wiki/Research/Harness-Reports/improvement-ledger.json` (55 entries, aggregates only: no per-cell data), and saved per-cell results JSON (`cells[]` with `tier, taskId, variant, run, accuracy, solved, billedTokens, iterations, traceFile`) under `wiki/Research/Ablations/**` and `wiki/Research/Harness-Reports/**`. Plan: `wiki/Planning/Implementation-Plans/2026-11-18-measurement-overhaul.md` (revision rules 4-8). Audit: `wiki/Research/Audits-2026-11-18-measurement/01-lift-gate.md`.

What I already know before running (so predictions are not post-hoc): the 2026-11-18 speedups receipts (lft: gemma h3-exact-value 0/5 vs 5/5; pth: 41/48 both arms, tokens about -33%), and the audit's simulation tables. I have NOT computed any v2 verdict, design effect, pass^k, ICC or trigger rate.

Known-outcome labels (fixed now, from the ledger rationale and ablation docs; graded by confidence): lft = HARMFUL (high: per-task 0/5 vs 5/5 traced to a defect); pth = EFFICIENCY-ONLY (high); act-or-answer on gpt-4o-mini `on` vs `off` = HARMFUL (medium: ledger reject -29.6pp); 2f progress-aware loop exit = HARMFUL/REJECTED (medium); the cells the ledger labels `inert`/`no-change` = INERT (low to medium). Ledger `decision` is the v1 gate's output, not truth, so it is never used as the label.

## S3 predictions

1. **P-S3-1 (v2 calls the two high-confidence outcomes).** v2 returns reject for lft (via the per-task magnitude veto, delta <= -40pp on exact-value, k=5 gemma) and non-reject with an efficiency win for pth. v1 gets lft right (rejects) but pth wrong (opt-in, no efficiency credit). Expect exactly one v1/v2 flip on these two: pth.
2. **P-S3-2 (sparsity).** Fewer than half of the usable comparisons (per tier-pair with >= 3 tasks and >= 3 runs/cell) resolve under v2 non-inferiority on the accuracy axis. Most come out `need-more-cells`. Reason: pooled n is about 15-25 cells per arm per tier, and a lower bound > -10pp needs SE <= about 6pp.
3. **P-S3-3 (v1 false rejects).** At least one comparison with an INERT label is rejected by v1 (1-sigma band), and v2 rejects none of them.
4. **P-S3-4 (clustering).** Treating cells as independent understates the SE of a single arm's pooled pass rate: the task-clustered SE is >= 1.5x the naive binomial SE on the median baseline arm (design effect from heterogeneous per-task pass rates). For the arm *difference*, task pairing cancels between-task variance, so cluster-robust paired SE / naive unpaired SE is < 1 on comparisons with homogeneous effects, and > 1 only where effects are heterogeneous (lft).
5. **P-S3-5 (pass^k).** On baseline arms with k >= 5, unbiased pass^5 is below 0.8x the pass^1 rate at the pooled level, because non-saturated tasks (required-tools, exact-value on small tiers) carry the decay.
6. **P-S3-6 (ICC and task value).** ICC(1) of task on binary solve is >= 0.4 on H3 baselines, and >= 35% of tasks are always-pass or always-fail on a given tier (non-discriminative). The discriminative set is small (about 3-5 of 11-13 tasks).

**Kill / redesign criteria S3.** KILL v2 as specified if it mis-calls lft (not reject) or pth (reject or harm instead of an efficiency non-reject), or if it rejects a comparison labelled high-confidence beneficial. REDESIGN if fewer than 6 usable comparisons exist (data too sparse to say) or if the non-inferiority arm resolves on < 15% of comparisons (rule unusable at our n). PASS otherwise, with every flip explained.

## S4 predictions

1. **P-S4-1.** `parallelToolHint` and `leanFinalTurn` fire in >= 90% and >= 50% of their own-arm cells respectively (the lft activity key may be absent from `mechanismActivity`: it covers guard-fired non-pass outcomes, signals, switches and requirements only, so lean_final_turn needs the raw `guard-fired` event, as `analyze.ts` does).
2. **P-S4-2.** At least half of the distinct activity keys across all traces fire in < 5% of cells. Loop detection, strategy switching, honest abstention and forcing nudges are among them.
3. **P-S4-3.** The exit gate / `dispatcher_early_stop` ending is the one high-frequency mechanism (>= 30% of cells, concentrated on todo-heavy).
4. **P-S4-4 (dilution).** For any mechanism with whole-suite trigger rate r < 0.15, a whole-suite +3pp lift requires effect-given-trigger >= 3pp / r >= 20pp, so a typical whole-suite A/B at n = 5 cannot see it.

**Kill / redesign criteria S4.** KILL the census as a method if saved traces that resolve on disk cover < 200 cells, or trigger keys cannot be attributed to a mechanism by name. REDESIGN (add a raw-event reader) if `mechanismActivity` alone misses a named mechanism. PASS if the table covers >= 6 mechanisms with per-task rates.

## Pre-declared v2 spec used by the S3 script (so it cannot drift to fit results)

- Accuracy axis, per tier, on **discriminative tasks only** (a task is discriminative when, pooling both arms on that tier, it has at least one pass and one fail). Stratified (CMH-weighted) risk difference, task as stratum. CI (decided before running, simplified from the audit): the WIDER of (a) Newcombe-Wilson hybrid 95% interval on the pooled discriminative cells (valid at p = 0/1; balanced allocation, so Simpson-safe) and (b) a task-clustered t-interval (T-1 df) on the per-task differences. Using the wider covers both small-n edge behaviour and task clustering. Verdict `NON-INFERIOR` iff point >= -3pp AND 95% lower bound > -10pp. `HARM` iff 95% upper bound < 0 and point <= -5pp.
- Per-task veto: any task with delta <= -40pp (cells >= 3 per arm per task) triggers a veto candidate. A rerun is not possible retrospectively, so a veto counts as `TASK-HARM (unreplicated)`; reported separately from confirmed reject.
- Efficiency axis: per-task log ratio of mean billed tokens (candidate/baseline), mean over tasks, t-interval (T-1 df). Also sign-flip permutation p. `SAVES` iff upper 95% bound < ln(0.95) (> 5% saving); `COSTS` iff lower bound > ln(1.15).
- Verdict table follows the plan: reject on HARM or confirmed TASK-HARM; reject-cost if COSTS and not superior; efficiency-win if NON-INFERIOR and SAVES; neutral/opt-in if NON-INFERIOR and flat; need-more-cells otherwise.
