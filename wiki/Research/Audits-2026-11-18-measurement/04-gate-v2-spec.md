---
type: spec
status: draft
created: 2026-11-18
tags: [gate-v2, lift-gate, non-inferiority, efficiency, ablation, measurement, spec]
---

# Gate v2 spec: promote on safe-and-cheaper, not only on better

Design only. No `packages/**/src/**` edit, no live model run. Authored by ablation-warden. Inputs: audit [[01-lift-gate]], the advisor revisions, "Statistical foundations" and "Spike results" in `wiki/Planning/Implementation-Plans/2026-11-18-measurement-overhaul.md`, spike S3 (`wiki/Research/Spikes-2026-11-18-measurement/S3.md`).

Executable reference of every rule below: `gate-v2-acceptance/rule.ts` (pure, zero token). Acceptance simulation: `gate-v2-acceptance/sim.ts`. Replay: `gate-v2-acceptance/replay.ts`. Generated outputs: `gate-v2-acceptance/results-{pipeline,power,replay}.md`. If this text and `rule.ts` disagree, fix whichever is wrong before build; production code must match the fixtures, not this prose.

**Owner policy (ratified, drives the whole design).** A mechanism that is non-inferior on accuracy (point >= -3pp AND lower bound > -10pp, discriminative tasks only, against a frozen reference baseline) and clearly cheaper in tokens per solved run MAY be promoted to default-on, via a screen at k=5 then a confirm at k=12 with no replicated per-task regression.

## 0. Headline (what the acceptance run says)

Numbers are from 500 simulated gate runs per scenario (zero tokens) over real per-task rates and token distributions of the saved H3 baselines (cogito:8b and qwen3:4b, 11 tasks each, 3 discriminative per tier). Details in section 11.

| Requirement | Result | Verdict |
|---|---|---|
| A/A false-reject <= 5% | 2.0% (spec allocation), 3.2% (owner-literal k=12), 3.0% (point rates) | PASS |
| False-promote, planted -20pp | 0.0% | PASS |
| False-promote, planted -10pp | 0.0% accuracy only; 4.0% in the hardest case (-10pp AND tokens x0.70); owner-literal k=12 gives 5.4% | PASS, marginal |
| Power, -30% tokens at equal accuracy | 71% (spec), 54% (owner-literal k=12) | **FAILS 80%**: ceiling set by non-inferiority, not by tokens (SAVES alone: 94%) |
| Power, -15% tokens at equal accuracy | 23% (spec), 11% (literal) | **FAILS**: needs ~50 runs per cell for 72% |
| Power, pth-like lever (saving carried by one task) with pre-registered trigger scope | 64% at -15%, 72% at -30% | partial; without scope 5% / 16% |

The limit, stated plainly. Today's suite has about 3 discriminative tasks per tier. With the point-estimate floor of -3pp, P(non-inferior | true effect 0) is 51% at confirm k=12 uniform and tops out near 77% at 30 runs per cell and 88% at 50, because the point floor, not the interval, binds. So the owner-literal "k=12 confirm" cannot promote an equal-accuracy mechanism more than about half the time even when the mechanism is exactly as good as the baseline and 30% cheaper. The rule is honest about it (`need-more-cells` with N) and the sim shows what buys power: more runs on discriminative tasks only, and above all more discriminative tasks (build task B2 below).

## 1. Evidence classes and what each may decide

| Class | Source | May reject | May promote | Exit effect |
|---|---|---|---|---|
| E1 live accuracy | paired runs, same tiers, same tasks | yes (harm, replicated task collapse, canary) | yes (non-inferior + E2, or superior) | 0 / 1 / 3 |
| E2 live efficiency | tokens per run and per solved run, turns, wall | yes (COSTS) | yes, only together with E1 non-inferior | 0 / 1 |
| E3 zero-token deterministic shape veto | Phase Z mock tier (S6): a recorded failure shape on which the mechanism `hurts`, with a cited source trace | **yes, hard**: `reject-shape`, no live run until fixed | never | 1 |
| E4 proximal-trigger probes | trigger census over saved traces; prefix-fork probe k=30 on trigger states, binary proximal outcome | yes (harm guard breach, exact one-sided p <= 0.05) | never alone; may lift `inert` to `opt-in` ("proximal moved") | 0 / 1 |
| E5 simulator (stochastic tier) | calibrated stochastic mock | no (advisory: adds tasks to the live set) | never | none |

Rules: E3 hard veto is the only pre-live reject. E4 and E5 never promote. A default-on verdict needs E1 and E2 live evidence on at least `minTiers: 2` tiers.

## 2. Inputs

Per tier, per task, per arm: the list of measured runs `{solved: boolean, tokens: number (billed where recorded, else raw), turns: number | null, wallMs}`. Timed-out cells keep their tokens and count as unsolved (audit 03 D6); inconclusive cells (infrastructure void) are excluded and reported. Task class comes from the frozen reference only (section 8). Optional inputs: pre-registration (section 7), trigger census counts, shape-veto results.

Compatibility gate (evaluated first; section 9) can return `void` before any statistics.

## 3. Accuracy axis (E1)

Unit of analysis is the task (fixed suite: the claim is about this suite, not a population of tasks). Strata = discriminative tasks (reference pass rate in [0.1, 0.9)) pooled across tiers.

For stratum t: `n_b,t`, `n_c,t` runs, `x_b,t`, `x_c,t` solved, `d_t = x_c/n_c - x_b/n_b`, CMH weight `w_t = n_eff,t / sum n_eff`, `n_eff,t = n_b n_c / (n_b + n_c)`.

- Effect: `RD = sum_t w_t d_t` (task-mean difference with fixed-suite weights).
- Interval: stratified Newcombe-Wilson hybrid. Per stratum take Wilson limits `(l, u)` at z for each arm; `LB = RD - sqrt(sum_t w_t^2 [(p_c,t - l_c,t)^2 + (u_b,t - p_b,t)^2])`, `UB = RD + sqrt(sum_t w_t^2 [(u_c,t - p_c,t)^2 + (p_b,t - l_b,t)^2])`. Valid at 0 and 1, no degrees of freedom, no t-interval on 1 to 3 tasks. Lower bound uses z = 1.645 (one-sided 95%); harm bound uses two-sided z: screen 2.576, confirm 1.96.
- Deviation from the brief, disclosed: the brief asked for a stratified exact or permutation interval. The sim measured this hybrid instead (type I error at the margin: 4.0% at the spec allocation, 5.4 to 7.0% at 12 runs per cell; section 11). An exact unconditional interval is a possible later upgrade; it is not needed to meet acceptance. The permutation machinery is used for the efficiency axis.
- Heterogeneity: Cochran Q and `I^2` over strata, reported (not gating).

States (evaluated per comparison, pooled over tiers, `strata >= 2`):

| State | Condition |
|---|---|
| `SUPERIOR` | `LB(z=1.645) > +3pp` and tier guard ok |
| `NON-INFERIOR` | `RD >= -3pp` AND `LB(z=1.645) > -10pp` AND tier guard ok |
| `HARM` | `UB(two-sided) < 0` AND `RD <= -5pp` |
| `UNRESOLVED` | otherwise; emits `need N` |

Tier guard: no single tier is in `HARM` state on its own strata (its own two-sided UB < 0 and point <= -5pp). It blocks NON-INFERIOR and SUPERIOR; it does not itself reject.

Canary pool (reference class `canary`, pass rate >= 0.9): pooled over tasks and tiers, one-sided Fisher exact "candidate worse", alpha 0.005 (screen) / 0.01 (confirm), AND observed drop >= 3pp. A hit is `canary-harm` -> `reject`. Reason: saturated tasks must not pad the non-inferiority pool (advisor 5) but a harm hidden on them must still be caught.

### 3.1 Per-task replicated veto (all tasks, all classes)

1. Trigger: a task with `n >= 3` in both arms and `delta <= -40pp` (candidate minus baseline pass rate).
2. Automatic solo rerun: `k = 5` fresh runs per arm on that task only, interleaved. No human decision, no opt-out.
3. Confirmed (`reject`, reason task-harm) iff the rerun ALONE has one-sided Fisher exact p (candidate worse) <= 0.05. At k=5 that means a collapse such as 0/5 vs >= 4/5, or 1/5 vs 5/5. Otherwise `cleared`.
4. A trigger without a rerun result (replay, or the runner has not run it yet) is `veto-pending`, exit 3. Never `reject` without the rerun (S3: 4 of 6 retrospective vetoes fired on non-harmful comparisons).

Why not Fisher plus Holm (audit 01 proposal): at k=3 two-sided p < .05 is unreachable and at k=5 only a full collapse survives Holm over 11 tasks (advisor 4). The trigger-then-replicate design keeps type I at the measured level below and detects real collapses (sim: one discriminative task to 0 is rejected 87% of the time at the screen stage; halving the task 29%).

## 4. Efficiency axis (E2)

Per tier, over the judged tasks (all tasks, or the pre-registered trigger scope; section 7):

- `tpr = (sum cand tokens / n_cand) / (sum base tokens / n_base)` tokens per run ratio (low variance).
- `tps = (sum cand tokens / solved_cand) / (sum base tokens / solved_base)` tokens per solved run ratio (the policy figure; it guards fail-fast survivorship: a candidate that is cheap because it gives up has a high `tps`). Reported on every receipt. Not used as the significance statistic: the solved count is binomial, so at our n the `tps` permutation test is much weaker (indicative, from an intermediate sim run not retained, and with different null ratios: `tps` against 0.90 gave 54% SAVES at -30% and k=12, `tpr` against 0.95 gives 94%).
- Turns ratio and wall ratio: reported, advisory. Wall time is not gating on shared hosts. Turns are not gating (a lever can cut turns without cutting tokens); they inform the pre-registered proximal metric.
- Per-task log ratios: reported with a two-sided sign-flip p over tasks (exact enumeration up to 16 tasks) and the count of tasks with ratio < 0.9. Descriptive only; they explain heterogeneity, they do not gate.

Inference: stratified (within-task) shifted permutation test, `B = 799`, seed fixed per evaluation. Candidate tokens are divided by the null ratio, run records are swapped between arms within each task, and the one-sided p is the share of permuted statistics at least as extreme. This keeps the heavy-tailed token distribution and the task mix intact; no normality, no bootstrap undercoverage at n = 3 to 5.

States per tier:

| State | Condition |
|---|---|
| `SAVES` | permutation test of H0 `tpr >= 0.95` has p <= 0.05 AND point `tpr < 0.90` AND (`tps <= 0.95` on all-task scope; scoped runs skip this term) AND all-task `tps <= 1.15` |
| `COSTS` | permutation p <= 0.05 (confirm) / 0.01 (screen) of H0 `tpr <= 1.15`, OR the same for `tps` |
| `NO-BENEFIT-SHOWN` | neither |

The null is 0.95 and the point floor is 0.90 on purpose: testing against 0.90 cannot resolve a true -15% (power about 3% at k=12 in an intermediate sim run, not retained; the retained run with null 0.95 gives 19% to 29%). "Clearly cheaper" is operationalised as a point saving of at least 10% that is statistically distinguishable from a saving below 5%.

Heterogeneity flag: drop the task with the largest absolute token saving; if the leave-it-out `tps >= 0.95` the saving is `conditional` (carried by one task, the pth shape). A conditional saving can default-on only when the pre-registration scoped the trigger (section 7); otherwise the verdict is `opt-in` ("saving carried by one task, trigger scope not pre-registered").

Token-free tiers (local models): `COSTS` blocks default-on but does not reject (owner ruling 2026-11-06 preserved). SAVES counts, since tokens are the local-time proxy.

## 5. Sizing: `need-more-cells` with N (Resolution paper N*/MDE, size at 1.2 N*)

Never power at the observed effect. Plan against the pre-registered or default effect and size at `1.2 N*` (empirical power 0.83 at N*, 0.89 at 1.2 N*).

- Accuracy non-inferiority, true difference assumed 0, margin `m = 10pp`, `z_a = 1.645`, `z_b = 0.8416`, `S` = discriminative strata, `pq = mean_t(p̄_t (1 - p̄_t))` with `p̄_t` the pooled arm rate (floor 0.02; effect-free variance only):
  `N*_acc = 2 (z_a + z_b)^2 pq / (S m^2)` runs per cell; `N_acc = ceil(1.2 N*_acc)`.
- Efficiency: `N*_eff = 2 (z_a + z_b)^2 mean(sigma_log^2) / (T ln(0.95 / r_plan)^2)`, `sigma_log^2` the within (task, arm) variance of ln tokens, `T` judged tasks, `r_plan` the pre-registered predicted ratio (default 0.80); `N_eff = ceil(1.2 N*_eff)`.
- Receipt prints `need n=<max(N_acc, N_eff)> per cell (<cells> more, ~<minutes> at <sec>/cell)` per tier, plus `MDE_80` at the current n: `(z_a + z_b) * sqrt(2 pq / (S n))`.
- Paired binary alternative (Resolution Eq 3 to 6) applies only once runs are seed-paired (build task B6); until then `rho = 0` and the formulas above are exact for unpaired arms.

Measured on today's suite (median over sims): `N_acc` about 30 runs per cell (about 6 pooled strata), `N_eff` about 9. The accuracy axis is the binding constraint.

## 6. Stages and the decision table

Fresh independent runs at each stage; the confirm decision uses confirm runs only (the screen is a filter and a harm look, never pooled into the promotion estimate: no optional stopping).

| Stage | Runs | May |
|---|---|---|
| screen | k = 5 per cell, every task of every tier, interleaved per (run, task), plus automatic veto reruns | kill (reject), drop (opt-in), advance. Never promote. |
| confirm | k = 12 per cell on every task; discriminative tasks topped up to 30 per cell (`confirmMinDiscRuns`); plus automatic veto reruns | promote, reject, opt-in, need-more-cells |

Looks: harm and canary are checked at both stages at strict fixed thresholds (screen 99% two-sided, confirm 95%); no alpha spending, no group-sequential boundaries (advisor 6). Promotion only at the pre-declared final n.

### 6.1 Decision table (evaluated top to bottom; first match wins)

| # | Condition | Verdict | Meaning for default-on | Exit |
|---|---|---|---|---|
| 0 | compatibility check fails (section 9) | `void` (reason list) | none; nothing is learned; rerun | 4 |
| 1 | E3 shape veto: a deterministic shape with a cited trace on which the mechanism `hurts` | `reject-shape` | REWORK; no live run until the shape is fixed | 1 |
| 2 | confirmed task veto, or accuracy `HARM`, or `canary-harm` (screen or confirm) | `reject` | REWORK or kill | 1 |
| 3 | task veto triggered, rerun not yet run | `veto-pending` (+ `next: rerun <tier>:<task> k=5`) | undecided; run the rerun | 3 |
| 4 | any tier efficiency `COSTS` and accuracy not `SUPERIOR`: non-token-free tier | `reject-cost` | REWORK | 1 |
| 4b | same, all `COSTS` tiers token-free | `opt-in` (reason: costs tokens) | blocks default-on | 0 |
| 5 | stage = screen and tier `tpr <= 0.95` on every tier and pooled disc RD >= -20pp, or pooled RD >= +3pp (and tier guard ok) | `screen-advance` (+ `next: confirm`) | none yet | 3 |
| 6 | stage = screen otherwise | `screen-drop` | opt-in: no signal worth confirm cost | 0 |
| 7 | stage = confirm and promotion n not met (`< 12` any cell or `< 30` on a discriminative cell) and an axis could otherwise resolve | `need-more-cells` (+ N) | none yet | 3 |
| 8 | confirm, accuracy `SUPERIOR` | `default-on` (accuracy win) | **default-on** (needs also minTiers >= 2, pre-registration present) | 0 |
| 9 | confirm, accuracy `NON-INFERIOR` AND every tier `SAVES` AND (not conditional, or trigger scope pre-registered) | `default-on` (efficiency win) | **default-on** (needs also minTiers >= 2, pre-registration present, BH pass) | 0 |
| 10 | confirm, accuracy `NON-INFERIOR` AND every tier `SAVES` AND conditional AND scope not pre-registered | `opt-in` (reason: one-task saving) | opt-in | 0 |
| 11 | confirm, accuracy `NON-INFERIOR`, efficiency not `SAVES`, n >= planned | `opt-in` (no demonstrated benefit) | opt-in | 0 |
| 12 | confirm, accuracy or efficiency unresolved and runs per cell < planned N | `need-more-cells` (+ N) | none yet | 3 |
| 13 | confirm, claims not demonstrated at planned n | `opt-in` ("NOT evidence of equivalence") | opt-in | 0 |

Additional gates that downgrade a statistical `default-on`: (a) fewer than `minTiers: 2` tiers or any inconclusive tier -> `opt-in` (coverage); (b) pre-registration absent -> `opt-in` (unregistered); (c) trigger census below `minTriggers` (default 8 in the candidate arm over the stage's cells) -> `inert`: verdict `opt-in` with reason "inert on this suite, NOT evidence of no effect; run prefix-fork probes"; (d) BH step (section 7.3) fails -> `opt-in` (batch FDR). Row 9's conditional case is the only path by which a trigger-conditioned lever, such as `parallelToolHint`, reaches default-on.

Exit codes. 0: final (`default-on`, `opt-in`). 1: final negative (`reject`, `reject-cost`, `reject-shape`). 2: usage / no tiers / `--activations 0` (unchanged from v1). 3: not final, more evidence is required (`veto-pending`, `screen-advance`, `need-more-cells`); the receipt carries `next` so scripts loop. 4: `void`. v1 `decision` stays the legacy field; the v2 verdict maps to it as `default-on -> default-on`, `reject*` -> `reject`, `need-more-cells | veto-pending | screen-advance -> underpowered`, everything else `opt-in`, and v1 is unchanged until the owner ratifies v2 (section 10).

## 7. Mechanism pre-registration, FDR

### 7.1 Schema (committed before any live cell; file `wiki/Research/Ablations/<date>-<id>/prereg.json`, hash recorded in the receipt)

```ts
interface MechanismPrereg {
  id: string;                         // mechanism key, as in run-started.config
  contrast: { armA: string; armB: string; mechanismEnvKeys: string[] }; // config hashes; only these keys may differ
  targetFailureShape: string;         // shape id from the zoo / rax-diagnose attribute reason
  proximalMetric: { name: string; definition: string; direction: "up" | "down" };
  triggerPredicate: { description: string; rawEventPredicate: string; expectedRatePerCell: number };
  triggerTasks: string[];             // scope for the SAVES test (may be empty = all tasks)
  harmGuard: { metric: string; maxDegradation: number };   // e.g. unsolved-with-trigger rate, abstention rate
  prediction: { accuracyRdPp: [number, number]; tpsRatio: [number, number]; plannedTprRatio: number };
  registeredAt: string;               // ISO date, must precede the first cell timestamp
}
```

Read order of a verdict (advisor 2): fired (census >= minTriggers) -> proximal moved -> efficiency -> accuracy non-inferior. A predicted-vs-observed line is printed on every receipt; misses are logged (S4: 5 of 11 predictions missed).

### 7.2 Probes

Proximal probes (E4) are prefix-fork by call index (S6: replay is blind to harness state), k = 30 per arm on a triggered state, binary proximal outcome, exact one-sided test against the pre-registered direction. A probe may confirm "proximal moved" and may flag harm (harm guard exact one-sided p <= 0.05); it cannot promote.

### 7.3 Benjamini-Hochberg

For a batch of `m >= 2` mechanisms confirmed in one campaign, collect the one-sided benefit p per mechanism (efficiency: the maximum of the per-tier `tpr` permutation p, intersection-union; accuracy-superior path: `p_sup = Phi(-(RD - 3pp) / SE)`, `SE = (RD - LB) / 1.645`), run BH at q = 0.05, and require BH rejection for any `default-on`. Harm tests are deliberately NOT corrected (a false reject costs a rerun; a missed harm costs a regression). `m = 1` degenerates to the plain test.

## 8. Frozen reference baseline

- Artifact per tier: `wiki/Research/Ablations/reference/<tier>-<suiteHash>-s<scorerVersion>.json` with: reasoning dist hash, harness config hash (R0), model digest, >= 15 runs per task from >= 2 independent sessions, per-task pass rate, per-task `mean/sd ln(tokens)`, class (`disc` 0.1 <= p < 0.9, `canary` p >= 0.9, `floor` p < 0.1), creation date.
- Task class is taken from the reference only. Classifying from the arms under test biases the risk difference upward through regression to the mean (a task selected for a lucky-low baseline looks improved). The sim draws a fresh 15-run reference per replication so classification noise is included.
- Each A/B runs its A arm (current default, mechanism off) in the same session, interleaved with B. The mechanism effect (veto, efficiency, harm) is B vs A.
- Cumulative guard (the drift fix): the ledger keeps `debtPp = sum over promotions since the last R0 refresh of max(0, -RD_i)`. A promotion's non-inferiority margin is `10pp - debtPp` (lower bound must exceed `-(10 - debtPp)`). Every third promotion, or 90 days, or any change of scorer version, suite hash or model digest, remeasure the current default against R0 at confirm n with the same rule; failing it freezes promotions and resets nothing until resolved.
- Baseline drift check (voids the run): the A arm's canary pool against the reference canary rates, one-sided Fisher exact alpha 0.01 -> `void: baseline-drift`.

## 9. Compatibility and provenance (refuse, do not warn)

`void` (exit 4), listing every reason, when any holds (`voidReasons` in `rule.ts`; field names follow `RunProvenance`, `packages/benchmarks/src/preflight-provenance.ts`):

- `scorerVersion` differs between arms or from the reference (`scorer-version.ts`; legacy files without the field are version 1; v1 and v2 results are never compared).
- `suiteHash` differs or is missing (new provenance field, build task B3).
- `reasoningDistHash` differs or is missing (reasoning exports `dist`; a git sha does not identify what ran).
- an `RA_*` flag in `raEnv` differs outside `contrast.mechanismEnvKeys`.
- `cellTimeoutSec` differs.
- a tier's `modelDigests` entry differs or is missing.
- more than 5% of cells carry a contention flag (`preflight` entries not ok, foreign loaded model, load per CPU above the threshold).
- arms were not interleaved per (run, task).
- `mechanism` pre-registration `registeredAt` is later than the first cell.

## 10. Receipt and ledger (additive; v1 `decision` untouched until ratification)

```ts
interface GateV2Receipt {
  version: 2;
  verdict: "default-on" | "opt-in" | "reject" | "reject-cost" | "reject-shape"
         | "need-more-cells" | "veto-pending" | "screen-advance" | "screen-drop" | "void";
  exitCode: 0 | 1 | 3 | 4;
  stage: "screen" | "confirm";
  path: string;                       // human reason, one line
  next?: string;                      // machine-actionable next step for exit 3
  accuracy: { strata: number; rdPp: number; loPp: number; hiPp: number; i2: number; state: string;
              tierPointsPp: Record<string, number>; canaryDropPp: number; canaryHarm: boolean };
  veto: { tier: string; taskId: string; deltaPp: number; status: "pending" | "confirmed" | "cleared" }[];
  efficiency: { tier: string; state: string; scoped: boolean; tprRatio: number; tpsRatio: number;
                savesP: number; costsP: number; leaveHeaviestOutRatio: number; conditional: boolean;
                turnRatio: number; wallRatio: number; perTaskSignFlipP: number }[];
  sizing: { runsPerCell: number; planNAccuracy: number; planNEfficiency: number; mde80Pp: number };
  mcnemar?: { b: number; c: number; p: number };   // descriptive until runs are seed-paired
  compat: { scorerVersion: number; reasoningDistHash: string | null; suiteHash: string | null; voidReasons: string[] };
  prereg?: { hash: string; predictedVsObserved: string };
  census?: { triggers: number; minTriggers: number };
  bh?: { batch: string; m: number; adjustedP: number };
  sim?: { evidence: "simulated (zero-token)"; shapeVerdicts: unknown[] };   // advisory, never promotes
}
```

Ledger entries gain optional `v2Verdict`, `v2ExitCode`, `rdPp`, `loPp`, `hiPp`, `tprRatio`, `tpsRatio`, `runsPerCell`; `recordGateOutcome` ignores unknown fields on read. `rax eval gate` prints v1 then v2 for one release, then flips default. Gate v1 and `run.ts` already share an options helper (commit `4253e3a2f`); v2 uses the same.

What each verdict means for default-on / opt-in / reject:

- `default-on` (rows 8, 9 plus the downgrade gates): flip the default; the pre-registration, receipt and ledger entry are the audit trail.
- `opt-in` (rows 4b, 6, 10, 11, 13, downgrades): the mechanism stays behind its flag. Not a statement of equivalence or of no effect.
- `reject*` and `reject-shape`: do not ship default-on; if the flag exists keep it off; the receipt names the failing evidence (task, shape, tier).
- exit 3 verdicts: not decisions. Run the named `next`.
- `void`: discard; no verdict, no ledger effect other than the void record.

## 11. Acceptance harness and results

Design. `gate-v2-acceptance/sim.ts` simulates the full pipeline (reference draw of 15 runs per task, screen at k=5, automatic veto reruns, confirm), zero tokens, deterministic seeds. Truth for each replication: per-task pass rate drawn `Beta(x+1, n-x+1)` from the real counts pooled over nine saved full-suite H3 baseline arms per tier (cogito:8b, qwen3:4b; 11 tasks each; heterogeneity and saturation are the real ones: cogito has 6 of 11 tasks at or near 0%), per-task `ln(tokens)` normal with the real mean and sd. A `--point` flag uses raw rates (section C of `results-pipeline.md`). Scenarios: A/A; accuracy -10 and -20pp (all tasks; or on tasks the gate classifies discriminative, so the planted harm sits inside the non-inferiority pool); -10pp with tokens x0.70 (cheap because worse); tokens x0.95 / x0.90 (null boundaries), x0.85, x0.70 (uniform); same -15% and -30% carried by the heaviest task only (pth-like), unscoped and with the trigger pre-registered; tokens x1.30; +10pp accuracy; one discriminative task to 0 and to half. Power curves at uniform k = 5, 12, 20, 30, 50 in `results-power.md`.

Results, spec allocation (screen k=5; confirm k=12, discriminative tasks 30; 500 reps):

| Scenario | promote % | reject % | mean cells (2 tiers x 11 tasks) |
|---|---|---|---|
| A/A | 0.2 | 2.0 | 615 |
| accuracy -10pp (all tasks) | 0.0 | 25.8 | 377 |
| accuracy -20pp (all tasks) | 0.0 | 60.8 | 308 |
| -10pp on classified-disc tasks, tokens x0.70 | 4.0 | 68.4 | 948 |
| -20pp on classified-disc tasks, tokens x0.70 | 0.0 | 90.0 | 705 |
| tokens x0.95 (SAVES null boundary) | 1.0 | 3.2 | 648 |
| tokens x0.90 | 4.4 | 3.8 | 758 |
| tokens x0.85 | 22.6 | 3.8 | 877 |
| tokens x0.70 | 71.4 | 4.4 | 1014 |
| -15% / -30% total, carried by heaviest task, unscoped | 4.8 / 15.6 | 4.0 / 4.2 | 888 / 978 |
| same, trigger scope pre-registered | 63.8 / 72.0 | 4.4 / 4.4 | 1014 / 1019 |
| tokens x1.30 | 0.6 | 54.0 (reject-cost 26 plus screen kills 27) | 468 |
| +10pp accuracy | 25.8 | 0.4 | 821 |
| one disc task to 0 | 0.0 | 86.8 | 272 |
| one disc task halves | 0.0 | 29.0 | 426 |

Owner-literal uniform confirm k=12 (no top-up): A/A reject 3.2%, false-promote 1.0%; -10pp+tokens x0.70 false-promote 5.4% (single-stage 7.0%); tokens x0.70 power 54%; x0.85 11%; scoped pth-like 50% / 55%. Non-inferiority power at true 0 effect, uniform single stage: 38% (k=5, cannot promote), 51% (k=12), 70% (k=20), 77% (k=30), 88% (k=50); tokens x0.70 promote at k = 12 / 20 / 30 / 50: 51% / 69% / 77% / 87%; tokens x0.85: 10% / 34% / 49% / 72%; cells 528 / 880 / 1320 / 2200 (about 2.8 / 4.6 / 7 / 11.6 hours at 19 s per cell).

Verdict on the acceptance criteria. A/A false reject <= 5%: met everywhere. False promote under planted -10 / -20pp: met (4.0% in the hardest -10pp case, margin to 5% is thin: it is a type I error at the exact margin; the two things that reduce it are the 30-run top-up and the screen). Power for -30% / -15% tokens: not met at 80% on the owner-literal plan (54%, 11%) and not at the spec plan (71%, 23%). The efficiency test is not the cause (SAVES 94% at -30%, 29% at -15%, k=12 plus top-up); non-inferiority at 3 discriminative tasks per tier is. State the limit: with the present suite, promotion power for an equal-accuracy cheaper mechanism is capped near 70% at about 1,000 cells and 77% at 1,300; the only way past it is more discriminative tasks (B2) or accepting a weaker point floor (owner decision D1).

Not done and not claimed: `wallRatio`, the per-task sign-flip p and the pre-registration date check are specified but not implemented in `rule.ts`; A/A false-reject measured on real half-splits through the final rule (S3 section E did it for the v2 draft: 0 to 5%); an exact-unconditional accuracy interval; the stochastic-tier simulator feeding E5; BH and the cumulative-debt rule are specified but not simulated; the `inert` census threshold of 8 is a guess, not measured.

## 12. Replay of the S3 comparisons through the spec rule

Zero tokens, `results-replay.md`. Deviations forced by retrospective data: task class from the pooled arms (no frozen reference exists for these runs), no automatic rerun (so a trigger is `veto-pending`), no pre-registration. Stage is `screen` when no cell has 8 or more runs, else `confirm`.

| id | known | v1 (S3) | spec verdict | reason |
|---|---|---|---|---|
| lft | HARMFUL (high) | reject | `veto-pending` (3); with E3 `reject-shape` | gemma exact-value -100pp, ab-trap-5 -40pp both pending rerun; S6 zero-token shape shows lft HURTS on prose-named inputs, so the live run should never have happened |
| pth | EFFICIENCY-ONLY (high) | opt-in | `screen-advance` (3) | SAVES on both tiers: tpr 0.61 / 0.67 (p .04 / .01); tps equal; with trigger scope {h3-todo-heavy} tpr 0.27 / 0.28 |
| aoa-gpt4omini | HARMFUL (medium) | reject | `veto-pending` | rw-7 -66.7pp at k=3 |
| calib-v3 | NEUTRAL | opt-in | `screen-drop` | no signal |
| v019-rerun | NEUTRAL | underpowered | `veto-pending` | qwen3:4b rw-6 -40pp at k=5 (S3: a chance split; the rerun clears it) |
| recent-head | NEUTRAL (low) | underpowered | `screen-advance` | NON-INFERIOR at screen k=3, no efficiency signal, advanced on accuracy floor |
| v019-vs-v018, recent-fixhead, 2f-lh, aoa-local, bat-h3mi2 | unlabelled | mixed | `screen-advance` | positive point estimates; fixhead and aoa-local SUPERIOR at k=3 (not a promotion: screen never promotes) |
| recent-fix2, pae-a1, pae-a2, pae-a3, ic, bat-custom | unlabelled | mixed | `screen-drop` | no signal |
| strat-switch, stl-h3, stl-wide | unlabelled | underpowered / opt-in | `veto-pending` | task deltas of -40 to -67pp at k=3 to 5 |
| wc | unlabelled | opt-in | `opt-in` | COSTS on token-free tiers (tpr 2.7 / 2.4) |
| strat-switch-k8, fam-nofam, fam-nocon | unlabelled | opt-in / reject / opt-in | `need-more-cells` | n = 8 per cell below plan (acc 64 to 98, eff 23 to 119) |

Class counts over the 24: `veto-pending` 6, `screen-advance` 7, `screen-drop` 7, `opt-in` 1, `need-more-cells` 3, `reject` 0, `default-on` 0. No NEUTRAL-labelled comparison is rejected. Nothing in the historical record would have been promoted at its n, which agrees with audit 01 (D2); the difference from v1 is that exit 3 says what to run next and pth is credited.

What the two named mechanisms get:

- `parallelToolHint`: `screen-advance`. Efficiency SAVES on both tiers is real and not carried only by the mass-weighted mean (tps equals tpr, so no survivorship). Accuracy is UNRESOLVED (RD 0.0 [-23.7, +30.6], 3 pooled discriminative strata). At confirm the rule would need about 70 runs per discriminative cell for non-inferiority at today's 3 strata, above the 30 top-up, so on the present suite pth ends `need-more-cells` / `opt-in` unless the discriminative set grows (B2) or its accuracy claim is carried by the pre-registered trigger tasks. This is the correct honest outcome and the reason B2 is on the build list.
- `leanFinalTurn`: `reject-shape` before any live cell (S6: with inputs named in prose, `leanFinalTurn` accepts a tool-less "I still need the second report" as final after one read). If it had been run live, the rule gives `veto-pending` on gemma exact-value 0/5 vs 5/5 (rerun at 0/5 vs 5/5 has Fisher p = 0.004, confirmed `reject`). The CI path alone does not reject (RD -33.3 [-50.5, +0.3]); the veto and the shape evidence carry it.

## 13. Unresolved decisions for the owner (max 5)

- D1. Point floor `RD >= -3pp`. It, not the interval, caps non-inferiority power (77% at 30 runs per cell, 88% at 50, true effect 0). Keep -3pp and grow the discriminative task set, or relax the point floor to -5pp (the interval bound `> -10pp` already protects)?
- D2. Confirm allocation. Spec requires discriminative tasks at 30 runs per cell (others 12): about 30 to 40% more cells than the owner-literal pipeline (mean 1,014 vs 735 at tokens x0.70; about 5 hours at 19 s per cell for screen plus confirm on 2 tiers), type I at the margin 4.0% vs 5.4 to 7.0% at literal k=12 which also cannot promote more than half the time. Accept?
- D3. Efficiency promotion of a trigger-conditioned lever (pth shape): default-on is allowed when the trigger scope is pre-registered and the saving is judged on it, with all-task `tps <= 1.15`. Ratify this path, and ratify "clearly cheaper" = point `tpr < 0.90` and p <= 0.05 against `tpr >= 0.95`.
- D4. Cumulative margin: `debtPp` budget against the frozen reference R0, remeasured every third promotion or 90 days. Ratify, and name who owns R0 refresh.
- D5. Token-free tiers: keep "COSTS never rejects there" (2026-11-06) or let it reject at the same threshold?

## 14. Minimum build tasks for harness-warden, in order

Owner: harness-warden, `packages/benchmarks/src/gate/**` (v2 under `gate/v2/`), tests under `packages/benchmarks/tests/`. Every task: `bun run repo verify packages/benchmarks`.

1. **B1 port the rule.** Move `rule.ts` to `gate/v2/` (pure, no I/O) and its statistics to a shared module with `gate/exact.ts`. Fixtures: `results-replay.md` (24 rows) as golden tests, a deterministic reduced-rep A/A and false-promote test (200 reps, bounds 6% / 6%), and unit tests for `stratifiedRD`, `fisherWorseP`, the permutation, sizing.
2. **B2 discriminative task bank (gating for any promotion).** Add discriminative H3 tasks until each tier has >= 8 with reference pass rate in [0.1, 0.9); drop saturated and floor tasks from screen runs, keep canary tasks. This is what raises non-inferiority power above the 77% cap.
3. **B3 provenance and compatibility.** Add `suiteHash`, `interleaved`, contended-cell fraction to the results provenance (`RunProvenance`); implement `voidReasons` as the first step of `rax eval gate --v2`; exit 4.
4. **B4 reference baseline.** Artifact writer and loader (section 8), class table, drift check, `debtPp` ledger field.
5. **B5 receipt, ledger, CLI.** `GateV2Receipt`, additive ledger fields, `rax eval gate --v2` printing v1 then v2, exit codes 3 and 4, `next`.
6. **B6 runner stages.** `run-ab.ts`: screen then confirm with fresh runs, discriminative top-up, automatic veto reruns, interleaving, per-run seed passing (variance-reduction spike; McNemar `b`/`c` descriptive until proven).
7. **B7 pre-registration and census.** `prereg.json` schema validation, trigger-census hook (S4 predicate), `inert` rule, BH across a batch.
8. **B8 dry run.** Replay every saved receipt with v1 and v2; publish the diff table; owner ratifies D1 to D5; only then does v2 gate anything. Zero-token Phase Z shape verdicts feed `sim` (E3) in parallel and need no v2 ratification.

Anchors: `gate-v2-acceptance/{rule,sim,replay}.ts`, `gate-v2-acceptance/results-{pipeline,power,replay}.md`, `packages/benchmarks/src/gate/{gate,exact,types}.ts`, `packages/benchmarks/src/spikes/{cells,comparisons,gate-v2,stats}.ts`, `packages/benchmarks/src/{preflight-provenance,scorer-version}.ts`, S3 `wiki/Research/Spikes-2026-11-18-measurement/S3.md`, S6 `S6.md`, audit [[01-lift-gate]].
