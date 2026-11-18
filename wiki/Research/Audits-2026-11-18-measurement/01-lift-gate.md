---
type: audit
status: complete
created: 2026-11-18
tags: [audit, lift-gate, statistics, ablation, measurement, gate-v2]
---

# Audit 01: is the lift gate statistically sound and decisive?

Read-only audit by ablation-warden. No packages source edited, no live model runs. Every number below is either read from code (file:line), read from receipts in `wiki/Research/Ablations/2026-11-18-speedups/results/`, or computed offline by replaying receipt data or synthetic Bernoulli data through the REAL `evaluateLiftGate` (zero tokens). Scratch scripts: `/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/dea9dbcb-714a-4b1f-83b7-d9cfddaf1661/scratchpad/{replay,sim,tok}.ts`.

**Bottom line.** The gate is conservative to the point of being non-decisive in the "helps" direction, noisy in the "hurts" direction, and blind to efficiency. At the sample sizes actually used (n=3..5 runs, 6 tasks) it cannot promote a real +20pp effect (1% default-on at n=5), falsely REJECTS a mechanism with zero true effect 19-25% of the time, and cannot represent "equal accuracy, 36% fewer tokens" except as "opt-in, no measurable effect".

## Ranked defects

| # | Sev | Defect | Evidence |
|---|---|---|---|
| D1 | High | **A/A false-reject 19-25%.** `regresses` uses the 1-sigma band (`significanceK: 1`, one-sided ~16% per tier) and ANY tier rejects. Two tiers give 1-(0.841)^2 = 29% asymptotically. The Agresti smoothing masks it at small n and fades as n grows, so the false-reject rate RISES with n (18.9% at n=3, 24.6% at n=20). | `gate.ts:352,409-410,512`; `types.ts:178`. Sim: true 0pp, 6 tasks, 2 tiers: reject 18.9/19.3/23.0/24.0/24.6% at n=3/5/8/12/20. A "pth-like" A/A (equal accuracy, tokens x0.6): reject 17-25%. |
| D2 | High | **Default-on is unreachable at real n.** Promotion needs lift > 1.96 x SE(D). At T=6 tasks, n=3..5, the 95% band is 19-27pp on real receipts (cogito pth 27.2pp, gemma pth 19.2pp), so any mean lift below that is "within noise". Near ceiling (H3 baselines 94-96%) the maximum possible lift is ~5pp, so the bar is arithmetically impossible. | `gate.ts:329,353,400-407`; replay `promotionNoisePp` 19.2-32.1pp. Sim: true +20pp, n=5: default-on 1.1%; n=12: 40.9%; n=20: 84%. Ceiling p=.95, true +5pp: 0% default-on up to n=12, 6.7% at n=20. |
| D3 | High | **Efficiency cannot promote and is barely measured.** Tokens enter only as an upper cap on overhead (`<= +15%`), never as a benefit, with no CI. Turns and wall time are not referenced anywhere in `gate/` (grep: zero hits for `turns`, `durationMs`). The token figure is a mass-weighted mean of per-task means, so one heavy task dominates. | `gate.ts:256-259,270-273,389-393`; `grep "meanDurationMs\|durationMs\|turns" gate/*.ts` finds nothing. pth: h3-todo-heavy is 53-57% of baseline tokens. Headline -35.9% billed, but per-task-equal geometric ratio is 0.854 (cogito, bootstrap 95% CI 0.804-0.912) and 0.872 (gemma, CI 0.804-0.940): real, tight, and invisible to the verdict. |
| D4 | High | **No per-task accuracy veto.** `perTask` d_t and se_t are computed and printed but never gate anything. A task that collapses is averaged away. The only per-task guard is the run-status read (`endStatus`), which the H3 adapter does not populate. | `gate.ts:237-245,164-187`. lft gemma h3-exact-value is 0/5 vs 5/5 (-100pp; Fisher exact p=0.0079; Holm over 6 tasks p=0.047, still significant). The pooled verdict only rejected because the 1-sigma band is loose: lift -24.4pp, SE 16.4pp, z=-1.49, 95% CI [-56.6, +7.7]. Right verdict, wrong statistical reason. |
| D5 | Med | **Ad-hoc SE.** `max(within, between)` with a normal critical value at T=6 (t(5)=2.57 would be the honest value for the between term). Agresti smoothing makes saturated cells look noisy (all-pass n=3 reports se=0.327 per task pair, 32.7pp, real variance 0). Conservative in one term, anti-conservative in the other. Treats tasks as random draws while the claim is about a fixed suite. | `gate.ts:320-329`; `report-format.ts:187-195`. Receipt `+0.0pp +/- 32.7pp` on every saturated cogito task. |
| D6 | Med | **`underpowered` fires only at n < 3, which is far below adequate.** At n=3..5 the gate says "opt-in, within noise", not "underpowered". `runsNeeded` is computed but never printed, and is wrong by a factor ~T (it ignores that D is a mean of T tasks) and sizes for 50% power (z=1.96, no z_beta). | `gate.ts:335,340-343`; `receipt.ts` has no `runsNeeded`. Replay: `runsNeeded` 1898-2091 per arm. Correct 80%-power size for +3pp at T=6 is 465-726 per cell. |
| D7 | Med | **Two gate entry points disagree.** `run.ts:305` passes `tasks` and `isTokenFreeTier`. `rax eval gate` (`eval-gate.ts:108`) passes neither, so on the CLI path local tiers are cost-bound and long-horizon tasks are scored short. Same report, possibly different verdict. | `apps/cli/src/commands/eval-gate.ts:108` vs `packages/benchmarks/src/run.ts:300-308`. |
| D8 | Low-Med | **Receipts lose the evidence.** The ledger stores `liftPp`, `tokenOverheadPct`, rationale, and decision. No CI, no n, no per-tier SE, no MDE. Exit code 0 covers both "default-on" and "within noise". | ledger entries 54/55; `eval-gate.ts:22-26`. |
| D9 | Low | **pass^8 hook is dormant** at every real n (needs n >= 8 in every paired cell). | `gate.ts:360-370`; receipts say "passK: underpowered". |
| D10 | Low | **No variance reduction.** Runs are not seed-paired (no `seed`/`temperature` in `run-h3.ts` or `run-ab.ts`), though arms are interleaved. The gate treats arms as independent samples. `variance` is a legacy field. | grep `seed\|temperature` in both: zero hits. |
| D11 | Low | **One timeout flips a whole tier to underpowered**, because `minRuns` is the minimum across EVERY paired cell. | `gate.ts:331-335`. |

## (1) Exact decision rule and thresholds

`DEFAULT_LIFT_POLICY` (`types.ts:172-181`): metric `accuracy`, `minLiftPp: 3`, `maxTokenOverheadPct: 15`, `tokenLeg: "billed"`, `minTiers: 2`, `significanceK: 1`, `promotionSignificanceK: 1.96`, `minRuns: 3`. Status-guard defaults 25pp / 2 runs (`types.ts:158-159`), per-task status 0.67 / k>=3 (`types.ts:169-170`). Inconclusive cell: more than 20% inconclusive runs (`report-format.ts:103`).

Per (tier x task-class) `computeEvidence` (`gate.ts:189-441`):

- `passes` = !inconclusive AND !underpowered AND !statusRegresses AND |lift| > 1.96 SE AND lift >= 3pp AND costOk AND pass^8-ok (`gate.ts:400-407`).
- `regresses` = statusRegresses OR (!inconclusive AND !underpowered AND |lift| > 1.0 SE AND lift < 0) (`gate.ts:409-410`).
- `costOk` (short class) = billed overhead <= 15%; always true on token-free tiers; long-horizon uses cost-per-deliverable (`gate.ts:372-395`).

Verdict order, `decide()` (`gate.ts:511-528`):

| Order | Condition | Verdict |
|---|---|---|
| 1 | any tier `regresses` | reject |
| 2 | any tier `underpowered` (some cell < 3 measured runs) | underpowered |
| 3 | no tier inconclusive, >= 2 tiers, every tier `passes` | default-on |
| 4 | else | opt-in |

CLI exit code: reject -> 1, no tiers or `--activations 0` -> 2, everything else 0 (`eval-gate.ts:22-26`). `h3/verdict.ts` is a separate, weaker instrument: pooled Wilson 95% intervals, "resolvable" only when intervals are disjoint (`verdict.ts:166`), with a harness-reason attribution drop as the success signal. It does not feed the lift gate.

## (2) What test is used

Not a per-cell binomial test, not a pooled test, not an exact test. A paired-by-task, normal-approximation z-test on the mean of per-task differences:

- Per cell: p_hat = mean of measured run scores; SE_cell = sqrt(p~(1-p~)) / sqrt(n), p~ = (x+1)/(n+2) (`gate.ts:63-66`, `report-format.ts:187-195`).
- Per task: d_t = p_cand - p_base; se_t^2 = se_base^2 + se_cand^2 (`gate.ts:237-245`).
- D = mean d_t. SE(D) = max( sqrt(sum se_t^2)/T , sd(d_t)/sqrt(T) ) (`gate.ts:320-326`).
- Exploratory band 1.0 x SE (regress), promotion band 1.96 x SE (`gate.ts:328-329`).
- "Paired" means joined on task id (`gate.ts:208-223`), not seed-paired runs. Tasks in one arm only are excluded and listed.

Tokens: arithmetic mean over tasks of `meanBilledTokens`, ratio against baseline, no interval (`gate.ts:270-273`).

## (3) Power: minimum detectable effect

Using the gate's own SE, SE(D) = s x sqrt(2/(n T)), T=6 tasks. s=0.4 is a saturated cell at n=3 (Agresti), s=0.5 the worst case. Table in percentage points; "MDE95" is the point where the 95% promotion band is crossed (50% power), "MDE80" the true effect needed for 80% power (2.8 x SE).

| runs/cell n | SE(D) pp (s=.4 / .5) | MDE95 pp | MDE80 pp |
|---|---|---|---|
| 3 | 13.3 / 16.7 | 26.1 / 32.7 | 37.3 / 46.7 |
| 5 | 10.3 / 12.9 | 20.2 / 25.3 | 28.9 / 36.2 |
| 8 | 8.2 / 10.2 | 16.0 / 20.0 | 22.9 / 28.6 |
| 12 | 6.7 / 8.3 | 13.1 / 16.3 | 18.7 / 23.3 |
| 20 | 5.2 / 6.5 | 10.1 / 12.7 | 14.5 / 18.1 |
| 50 | 3.3 / 4.1 | 6.4 / 8.0 | 9.1 / 11.4 |

Checks against real receipts: the receipt shows 13.3pp on a saturated T=6 tier at n=3 (matches 13.3), and `promotionNoisePp` 19.2-32.1pp. Runs per cell needed for 80% power on the 3pp floor: 465 (s=.4) to 726 (s=.5), i.e. several thousand H3 cells per tier at ~19 s each. The policy's own `minLiftPp: 3` is not resolvable with any tractable local-model run. Simulation confirms (true effect vs default-on rate, T=6, 2 tiers, 1500 reps): +10pp: 0.0/0.2/2.0/6.7/24.8% at n=3/5/8/12/20; +20pp: 0.5/1.1/11.7/40.9/84.0%.

## (4) How efficiency enters

Confirmed: it cannot promote. The only efficiency term is `costOk` (`gate.ts:389-393`), a cap, binary, no CI, and it is ignored entirely on token-free tiers (`gate.ts:395`; owner ruling 2026-11-06, but only on the `run.ts` path, see D7). Turns and wall time: absent from the gate. Consequence on a real receipt: ledger entry 54 (`parallelToolHint`), 41/48 solved in both arms, turns -37%, billed -33% to -39% on both tiers, is recorded as `OPT-IN - within the noise floor; no measurable effect (NOT evidence of equivalence)` (`gate-receipt-pth.txt`). The README notes this: "The gate has no non-inferior plus savings path".

## (5) Per-task regression handling

Printed, not gated (D4). Per-task rows appear in the receipt as `d +/- se` and play no role in the verdict. The sole per-task rule is the status guard (`gate.ts:164-187`, 0.67 non-success rate, k>=3) which needs `endStatus` on runs. The H3 adapter `to-session.ts` writes `status`, not `endStatus`, so that guard was silent on both 2026-11-18 receipts.

## (6) How underpowered / opt-in / reject arise, and are they informative

- `reject`: informative only at large effects. Fires at 1 sigma, so it is ~16% one-sided per tier under the null (D1). lft was a true defect (0/5 vs 5/5) but the gate's own CI for the tier, [-56.6, +7.7]pp, includes zero.
- `underpowered`: fires only when some cell has < 3 measured runs. It says nothing about n=3..5 being useless (D6). Never appeared in 6,000+ simulated gate evaluations at n>=3.
- `opt-in`: a catch-all bucket for "positive but not promotable", "one tier", "inconclusive tier" and "no information". The rationale string distinguishes "within the noise floor" from "below the promotion bar", but the verdict value does not, and the exit code is the same as default-on.
- The rationale text that says "NOT evidence of equivalence" is correct and is the only honest statement; but there is no path that CAN establish equivalence.

## (7) Multiple comparisons, nondeterminism, pairing

- Reject is an OR over tiers (and over long/short classes when both exist), each at ~16% one-sided: FWER 29% at 2 tiers, no correction. Promotion is an AND of 95% bands: type-I ~0.0006 and power collapses (D2). The asymmetry is deliberate in the docs but never quantified; this audit quantifies it.
- Six tasks and per-task status checks add further uncorrected looks (`gate.ts:164-187`).
- Model nondeterminism is the whole noise source, and is not reduced: no seeds, no temperature control, runs treated as independent (D10). Arms are interleaved per (run, task) in `run-ab.ts`, which controls host drift but is not used by the estimator.
- Resampling, not re-running, would flip signs: the repo's own comment records two n=3 runs of the same comparison flipping from +4.5pp to -10.6pp (`gate.ts:561-563`).

## (8) Wall-clock cost

- The gate itself: a pure function; replaying the 36-cell session twice takes well under a second.
- A gate-quality run: all cost is model generation on one local GPU, sequential, with a "no foreign Ollama client" requirement. `wiki/Research/Ablations/2026-11-18-speedups/results/host.log`: valid matrix 09:19 to 10:06 = ~47 min for 144 cells = ~19 s/cell. Cogito was cut from k=5 to k=3 because the full matrix was estimated at >3 h. A prior attempt (11-17) was voided by GPU contention.
- For the policy's own bar (~465+ runs per cell) the cost is not 47 minutes but days. The cost driver is n x T x arms x tiers, and the current design buys almost no information per cell on the accuracy axis.

## (9) Misleading outcomes, replayed offline

Replay of `results/session.json` through `evaluateLiftGate` (`replay.ts`, `tok.ts`):

| Case | Gate says | Truth the data supports |
|---|---|---|
| pth vs off, both tiers | OPT-IN, "no measurable effect"; ignores tokens | Equal pass (41/48 both arms), billed tokens -33..-39% (per-task-equal geo ratio 0.85-0.87, CI excludes 1), turns -37%. Efficiency win, not representable (D3). |
| pth gemma accuracy | -1.8pp, SE 9.8, CI [-21.0, +17.4] | Cannot exclude a 20pp loss: no way to say "non-inferior" and no output stating how many more cells are needed. |
| lft gemma | REJECT via 1-sigma | Correct defect (exact-value 0/5 vs 5/5, p=0.0079), but pooled CI [-56.6, +7.7] would NOT survive a 95% test. Passing for the wrong reason. |
| lft cogito | +3.7pp "BELOW" | CI [-23.2, +30.6], i.e. nothing. |
| Any A/A, n=5 | reject 19.3% | Zero true effect. |
| True +20pp, n=5 | default-on 1.1%, opt-in 98.9% | A large real effect is called "no measurable effect". |
| Ceiling base 95%, true +5pp | opt-in 100% up to n=12 | Unreachable bar. |

Simulation table (full): scenario x n in {3,5,8,12,20}, 1500 reps, 2 tiers, 6 tasks, base p = [.95,.9,.8,.9,.6,.85], percent default-on / opt-in / reject:

| scenario | n=3 | n=5 | n=8 | n=12 | n=20 |
|---|---|---|---|---|---|
| A/A | 0/81/19 | 0/81/19 | 0.1/77/23 | 0/76/24 | 0/75/25 |
| true +10pp | 0/99/1 | 0.2/99/1 | 2/98/0 | 7/93/0 | 25/75/0 |
| true +20pp | 0.5/99.5/0 | 1/99/0 | 12/88/0 | 41/59/0 | 84/16/0 |
| true -10pp | 0/43/57 | 0/35/65 | 0/22/78 | 0/13/88 | 0/4/96 |
| true -20pp | 0/13/87 | 0/6/94 | 0/1/99 | 0/0/100 | 0/0/100 |

So the gate is decisive on large harm, and only on large harm. A true -10pp regression is missed 35% of the time at n=5.

## Gate v2 design (additive, proposal only; nothing implemented)

**Principles.** (a) Two axes judged separately, then combined. (b) Accuracy uses a non-inferiority margin, not "lift >= 3pp". (c) Efficiency is measured on continuous metrics, which are high-power at small n (the pth token CI is +/-5% at n=3..5). (d) Output always carries effect size, CI and "need N more cells". (e) Per-task regressions veto. (f) All of it lives under a new `v2` field on `GateVerdict` and ledger entries; `decision`, `perTier`, `aggregate`, `rationale` are untouched, and old receipts re-score as before.

### Statistics

Notation: T tasks (strata), n_t,a runs of arm a on task t, x_t,a successes (or graded sum), N = sum n.

1. **Accuracy effect.** Stratified risk difference with task as fixed stratum (the claim is about the suite): RD = sum w_t d_t, w_t = n_eff,t / sum n_eff, n_eff,t = n_t,b n_t,c / (n_t,b + n_t,c) (Cochran-Mantel-Haenszel weights). CI: Miettinen-Nurminen / Newcombe-Wilson hybrid, valid at p=0 and p=1 (replaces Agresti-smoothed Wald which inflates saturated cells). Report the 90% two-sided CI (= 95% one-sided bounds) plus a between-task heterogeneity flag (Cochran Q, I^2) instead of folding sd(d_t)/sqrt(T) into the SE. Graded scores: use the same on the mean with a bootstrap over runs within task.
2. **Accuracy states per tier**, margin m (default **10pp** for "equal pass", 15pp for fast screens; recorded on the receipt):
   - `SUPERIOR`: lower bound of the one-sided 95% CI > +minLiftPp (default 3pp; legacy compatible).
   - `NON-INFERIOR`: lower bound > -m.
   - `HARM`: upper bound of the 95% two-sided CI < 0 AND RD <= -m/2, OR per-task veto below.
   - `UNRESOLVED`: none of the above; emits `needMoreCells`.
3. **Per-task veto.** For each task, Fisher exact (one-sided toward harm), Holm adjusted across the T tasks at alpha 0.05, plus a magnitude floor d_t <= -30pp (or <= -2 x m). Any hit = `TASK-HARM` -> reject (exit 1). Under this rule lft gemma h3-exact-value (p=0.0079, Holm 0.047, -100pp) vetoes on its own evidence. Under the null it adds <= 5% FWER by construction. Also keep the existing `endStatus` guard.
4. **Efficiency effect (token, turns, wall, each separately).** Per task log ratio r_t = ln( mean_c / mean_b ); effect = unweighted mean over tasks (geometric mean ratio; avoids one heavy task dominating) and also report the mass-weighted ratio the gate uses today, labelled. CI: bootstrap over runs within (task, arm), 4000 resamples, fixed seed. Robustness: leave-one-task-out upper bound must stay below the threshold, else the saving is labelled `single-task`. States: `SAVES` (upper CI of ratio < 1 - e, default e = 10%), `COSTS` (lower CI > 1.15, parity with the 15% cap), `NEUTRAL` (CI inside [0.90, 1.15]), `UNRESOLVED`. Wall time is flagged informational on shared hosts (load noise, README setup note); turns and tokens are the gating legs.
5. **Cross-tier combination.** Worst tier per axis (conservative), minTiers 2 retained. Report per tier too.

### Exact verdict table (v2, evaluated in order)

| # | Condition | v2 verdict | Maps to v1 `decision` field | Exit |
|---|---|---|---|---|
| 1 | any tier accuracy `HARM`, or any `TASK-HARM`, or status guard | `reject` | reject | 1 |
| 2 | any tier efficiency `COSTS` and accuracy not `SUPERIOR` | `reject-cost` | reject | 1 |
| 3 | < minTiers tiers, or any tier inconclusive, or activations = 0 | `opt-in` (reason: coverage / void) | opt-in | 0 or 2 |
| 4 | all tiers accuracy `SUPERIOR` and no tier efficiency `COSTS` | `default-on` (accuracy win) | default-on | 0 |
| 5 | all tiers accuracy `NON-INFERIOR`+ and all tiers efficiency `SAVES` | `default-on` (efficiency win) | default-on only if owner enables the efficiency path, else opt-in | 0 |
| 6 | all tiers accuracy `NON-INFERIOR`+ and efficiency `NEUTRAL` | `opt-in` (no demonstrated benefit) | opt-in | 0 |
| 7 | any axis `UNRESOLVED` | `need-more-cells` with N | underpowered | 3 (new) |

Row 5 is the new path. Because it changes what "default-on" means, it needs a ratification (amend 09), and until then the receipt prints the v2 verdict while `decision` stays on the v1 value. Row 7 gets its own exit code so scripts can loop.

### "Need N more cells" and adaptive n

Per tier, per axis, from the current pooled variance and the active margin:

- Accuracy non-inferiority with true diff assumed 0: n per cell = 2 s^2 (z_a + z_b)^2 / (T (m - |delta0|)^2), z_a = 1.645, z_b = 0.84 (80% power), s^2 = p_bar(1 - p_bar) from the data.
- Efficiency: n per cell = 2 sigma_log^2 (z_a + z_b)^2 / (T ln(1-e)^2), sigma_log from the pooled within-cell SD of log tokens.
- Printed as: `need n=<k> per cell (<cells> more, ~<minutes> at <sec>/cell)`. The number is the MAX over axes and tiers.

Sample size per scenario (T=6 tasks, per tier, per arm, 80% power, one-sided alpha 0.05; computed with the formulas above):

| scenario | variance | accuracy NI margin | n per cell | cells/tier (x2 arms) | ~time @19 s |
|---|---|---|---|---|---|
| near-ceiling baseline (p~.95), efficiency lever (pth-like) | s^2=.048 | 15pp | 5 | 60 | 19 min |
| same | s^2=.048 | 10pp | 10 | 120 | 38 min |
| same | s^2=.048 | 5pp | 39 | 468 | 2.5 h |
| mid baseline (p~.8) | s^2=.16 | 15pp | 15 | 180 | 57 min |
| same | s^2=.16 | 10pp | 33 | 396 | 2.1 h |
| worst case (p~.5) | s^2=.25 | 15pp | 23 | 276 | 1.5 h |
| same | s^2=.25 | 10pp | 51 | 612 | 3.2 h |
| efficiency SAVES >= 10%, sigma_log=.135 (observed on pth) | - | - | 5 | 60 | 19 min |
| accuracy SUPERIOR >= +10pp over baseline p~.8 | s^2=.16 | lower bound > +3pp | 24 to 33 | 288 to 396 | 1.5 to 2.1 h |

The honest reading: accuracy cannot be made both cheap and decisive on binary H3 tasks. The efficiency axis can, and so can catching large harm (per-task veto fires at 5 runs per arm on a 0/5 vs 5/5 split).

**Adaptive design (to make runs "quick").** Group-sequential with looks at n = 3, 5, 8, 12 per cell, Lan-DeMets O'Brien-Fleming spending for efficacy and futility, one-sided alpha 0.05 overall:
- After every look recompute states; stop and verdict as soon as any axis resolves to HARM / TASK-HARM (large harm exits at the first look that crosses the boundary), or both axes resolve.
- Futility stop: if accuracy `NON-INFERIOR` is unreachable (upper possible lower bound < -m even at n=20) emit `reject-futile`, saving the remaining cells.
- Expected savings over fixed n=12: large harm stops at n=5 (~58% fewer cells); a real efficiency lever with equal accuracy stops at the look where NI resolves (n=8..12, close to the fixed design); a null lever with no efficiency effect stops at row 6 after n=5 on the efficiency axis alone, unless accuracy is the claim.
- Implementation hint: `run-ab.ts` already interleaves per (run, task). Add a `--look-at 3,5,8,12` option that evaluates after each full run round and exits when the verdict is terminal.

### Variance reduction (free)

1. Seed-pair arms (same seed per (task, run index)) and use paired McNemar-style discordant counts. Needs the runner to pass a seed; effect size is unknown until measured, treat as a spike.
2. Hold temperature fixed in the harness instruments (currently unset in `run-h3.ts`).
3. Add 2-3 more tasks rather than more runs per task when heterogeneity is the limit (the `between` term never shrinks with n).

### Back-compat (additive)

- New optional `GateVerdict.v2?: { accuracy: AxisState[], efficiency: AxisState[], perTaskVeto: ..., needMore?: ..., margin: number, verdict: ... }`; each `TierEvidence` gains optional `ci`, `rd`, `n`, `mde80`.
- `LiftPolicy` gains optional `marginPp`, `efficiencyMinSavingPct`, `looks`; defaults reproduce today's numbers when `v2` is not requested.
- Ledger gets additive `ci`, `n`, `v2Verdict`; existing entries stay valid; `recordGateOutcome` ignores unknown fields on read.
- `rax eval gate` prints both receipts for one release (v1 then v2), then flips default.
- Fix D7 first (cheap): make `eval-gate.ts` share the options helper with `run.ts`.

### Cheap fixes that do not need v2

In priority order (all are in `packages/benchmarks/src/gate/**` or `apps/cli`, owned by a domain warden; not edited here):

1. D1: reject at the 95% two-sided band plus a magnitude floor, or require two consecutive tiers; kills the 19-25% false rejects. Re-ablation required: this changes what REJECT means.
2. D6: print `runsNeeded` with T and z_beta in the receipt; rename the n<3 branch to what it is, and add "MDE at current n: X pp" to every receipt.
3. D3: print the geometric per-task token ratio and turns beside the mass-weighted figure, on the receipt only.
4. D4: print the per-task Fisher p beside `d +/- se`.
5. D7: one shared policy/options builder.

## Verdict on the mission question

**REWORK the gate** before it is used to say "helps / hurts / neutral" for any mechanism, with these caveats on scope: the audit measured the instrument, not a candidate mechanism; v2 is untested; sample sizes above are analytic (formulas, not executed v2). Opt-in discipline for the 2026-11-18 candidates stands (pth OPT-IN, lft REJECT) because nothing here supports promotion, but the pth outcome should be re-read as "efficiency win, accuracy unresolved", not "no effect".

Anchors: `packages/benchmarks/src/gate/gate.ts`, `types.ts`, `receipt.ts`, `on-path.ts`; `packages/benchmarks/src/report-format.ts:103,187-195`; `apps/cli/src/commands/eval-gate.ts:22-26,108`; `packages/benchmarks/src/run.ts:300-308`; `packages/benchmarks/src/h3/verdict.ts:166`; receipts `wiki/Research/Ablations/2026-11-18-speedups/results/{gate-receipt-pth,gate-receipt-lft,session,host.log}`; ledger entries 54, 55.
