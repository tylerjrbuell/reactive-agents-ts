---
type: plan
status: draft
created: 2026-11-18
tags: [measurement, gate, eval, harness, lift, feedback-loop]
---

# Measurement overhaul: truthful gate, sound scorers, fast loop

Source audits (read first): `wiki/Research/Audits-2026-11-18-measurement/` 01 lift gate, 02 graders and judges, 03 feedback loop.

**Thesis.** "Building blind" is an instrument problem in three layers: the verdict rule (01), the scorers feeding it (02), and the loop around it (03). Binary accuracy on H3 cannot be both cheap and decisive; efficiency, large-harm detection and graded scores are where power is.

## Phase 0: instrument truth (days; no new mechanism, fixes only)

Owner: harness-warden (`packages/benchmarks`, `packages/trace`), kernel-warden for 0.4.

| # | Fix | Source |
|---|---|---|
| 0.1 | One shared gate-options helper so `rax eval gate` and `run.ts` agree (`tokenFree`, long-horizon). Print `runsNeeded` (fix the ~T factor) and per-task Fisher p on receipts. | 01 D5/D7 |
| 0.2 | Results record provenance: dist hash, RA_* flags, cell timeout, model digest, start margin. Runner default timeout 150 to 180 (match skill/baselines). Timed-out cells' tokens kept in the token mean. | 03 D3/D6 |
| 0.3 | Preflight + contamination guard: `api/ps` foreign-model check, load check, refuse/flag. | 03 D4 |
| 0.4 | Honest decline stopped by `dispatcher_early_stop` resolves to abstain (shared terminal path). | 02 D1, 03 D5 |
| 0.5 | Attribution: `ruleFalseVeto` before `ruleFabricationVetoed`; `forcing-unused` only when the lever is available. Before/after `attribute --all` table. | 03 D5 |
| 0.6 | Fix leaky scorers (rw-3 "40%"), remove dead `answerCorrect` hidden check, decouple abstention from the accuracy score (rw-6). Rescore saved data before/after; comparability break noted in receipts. | 02 D2/D5/D6 |
| 0.7 | verdict.ts pass-rate uses the gate's paired-by-task estimator, not disjoint pooled Wilson (it printed NO-CHANGE for a lever the gate rejected). | 03 D1 |

## Phase 1: gate v2 (additive `v2` field; v1 `decision` unchanged)

Owner: ablation-warden spec, harness-warden build in `packages/benchmarks/src/gate`.

- Accuracy axis: stratified risk difference, Newcombe/Miettinen-Nurminen CI, non-inferiority margin (default 10pp).
- Efficiency axis: per-task geometric token and turn ratio, bootstrap CI.
- Per-task veto: Fisher + Holm.
- New verdict `need-more-cells` (own exit code, prints N needed).
- Group-sequential looks at n = 3, 5, 8, 12; stop for harm/inert/futility.
- Dry-run: replay all existing receipts, publish a v1-vs-v2 diff table before v2 gates anything.
- Policy (owner ratification required): non-inferior + clearly efficient may promote to default-on.

## Phase 2: graded scoring

Owner: eval-warden (schema, judge-server receipts, zero-layer fix `verification-service.ts`), harness-warden (verdict consumes it).

- Additive `GradedOutcome` 0-1 on results; deterministic partial credit first (rubric checks per task).
- Judge (Jev/nimble) only for the ambiguous middle: honest-decline detection, multi-criterion rubrics, ungroundable groundedness. Offline on saved traces, never during a bench. Pinned model+prompt version in receipts. Calibration: 60 hand-labelled cells, kappa >= 0.7 before it may influence a verdict.
- Note: Jev's variance win is POC-scoped; the 2026-09-23 gate found parity (n=16); no data on nimble.

## Phase 3: fast tiered loop

- Tier 0 (seconds, zero token): replay goldens, cf-* scenarios, failure-shape zoo (exact-value partial answer, honest decline stopped early, false veto, no-call stall), scorer fixtures.
- Tier 1 smoke: cogito:8b on exact-value, todo-heavy, required-tools, plan-only; k=5 paired interleaved; sequential stopping; ~5-10 min/arm; ~19pp pooled detectable.
- Tier 2 full gate: default-on candidates only; 11 tasks, k>=8, 3 tiers; ~29 min/arm on cogito; MDE ~9pp.
- Canary: always-pass tasks, k=3, ~4.5 min.
- Task pruning: ~66% of qwen3:4b wall is on 10/10 or 0/10 tasks; drop from smoke, keep in canary. Replace saturated/floor tasks with discriminative ones.
- Unattended detached driver (bench cells get SIGKILLed as bg tool tasks): owner decision.

## Revision after advisor review (Fable, 2026-11-18) — supersedes conflicting text above

**Plan changes**
1. **Condition on the trigger.** Effect = P(trigger) x effect-given-trigger; whole-suite runs dilute it. Add (a) a zero-token trigger census over saved traces before any live cell, (b) prefix-fork probes: replay a recorded run to the trigger state (`packages/replay`), sample only the next model turn live, on vs off, k=30, binary proximal outcome.
2. **Pre-registered proximal metric per mechanism** (target failure shape, activity key, proximal metric, harm guard). Read order: fired, proximal moved, efficiency, accuracy non-inferior. Wire `verdict.ts` activity keys and reason-drop into the gate.
3. **Seed pairing moves into Phase 0** (McNemar on discordant pairs = our variance reduction). Unverified: Ollama seed honoured via `providers/local.ts`, GPU determinism, temp 0 not the user distribution.
4. **Per-task Fisher+Holm veto is nearly dead at planned n** (k=3 can never reach p<.05 two-sided; k=5 only a full 0/5 vs 5/5 collapse survives Holm over 11 tasks). Replace: magnitude trigger (task delta <= -40pp), automatic k=5 solo rerun, veto if it replicates.
5. **Non-inferiority: not 10pp as a licence.** Compare to a frozen reference baseline (no drift across promotions); require point estimate >= -3pp AND lower bound > -10pp; compute on discriminative tasks only (saturated tasks must not pad the pool).
6. **Cut group-sequential alpha spending.** Harm and inert checks every round at a strict fixed threshold; promotion only at a pre-declared final n (screen k=5, confirm k=12).
7. **Efficiency axis:** per-task log ratios with t-interval or sign-flip permutation test (bootstrap at n=3 under-covers); primary figure = tokens per solved task (guards fail-fast survivorship).
8. **Gate v2 acceptance:** simulated A/A false-reject <= 5% and stated power on planted -20pp harm and -15% tokens, using the audit's `sim.ts`, before v2 gates anything; plus the receipts dry-run diff.
9. **Order: zero-token tier before gate v2** (it would have caught the lft defect that cost a 46 min A/B). **Defer the Phase 2 judge** (labelling + kappa) indefinitely; H3 is deterministic. Keep only "verdict reads graded accuracy" (0.7) and add `scorerVersion` to receipts (0.6). No Bayesian loss rules yet.

**Phase Z (new, first): deterministic mock-provider tier** — `packages/benchmarks/src/sim/` (harness-warden; provider fixes by provider-warden/testing owner)
- `policy-model.ts`: `PolicyModel = (req, rng, purpose) => TestTurn`; `policyLLMLayer(model, seed)` routes by purpose (harness calls never consume agent script) and records requests.
- `shapes/*.ts`: `{ id, sourceTraceId, task, tools, policy, ideal:{terminatedBy,status,toolSeq,maxTurns} }`; `run-shape.ts` -> `runArm(shape, harness)`; `matrix.ts` shapes x mechanisms x {off,on} -> `helps|hurts|neutral|inert` + turn/token deltas; `tiers/*.json` seeded failure+compliance rates with provenance; `calibrate.ts`; CLI `bench:sim --mechanism X [--tier cogito-8b --seeds 500]`.
- First 5 shapes (from real traces): (1) partial answer with unread input (exact-value, lft defect); (2) honest decline stopped by `dispatcher_early_stop` (ab-trap-5); (3) no-call stall x4 (rw-7, actOrAnswer); (4) correct answer vetoed as fabrication (rw-6); (5) sequential independent calls hitting the iteration cap (todo-heavy, wrapUpReserve). Then repeat loop, hallucinated tool, premature final.
- Deterministic-decidable: loop detection, exit gate, termination labels, abstention resolution, budget/wrap-up/iteration caps, tool batching/healing, verifier false veto, request shape/size for prompt mechanisms, activity-emission. Needs live: whether the model complies with a prompt change (`parallelToolHint`, guidance, forcing nudges); forcing firing is deterministic, compliance is live.
- Known gaps to fix first: `fakeUsage` (`llm-provider/src/testing.ts:77-84,316`) ignores history and tool schemas (count tokens from the recorded `CompletionRequest`); static turns only (no reactive model); `ScenarioConfig` has no harness-config field and `runCounterfactual` writes to /tmp (tmpfs OOM); classifier peek protects only `toolCall` turns, so a `text`-first script can be eaten by a harness call.
- Stochastic tier model (`pStall`, `pPrematureFinal`, `pRepeat`, `pHallucinatedTool`, `pDecline`, compliance given a guidance marker): sweep compliance 0..1 to see whether a mechanism is harmful everywhere (veto) or only helps above x (the live question shrinks to one parameter, estimated with prefix-fork probes); power-plan live n = trigger rate x simulated effect. Fit rates from `rax-diagnose attribute` and compliance from existing receipts; must reproduce pth and lft directionally on held-out data before use; log predicted vs observed on every later live run.
- **Gate feed:** additive `GateVerdict.sim`, labelled `evidence: simulated (zero-token)`. Deterministic shape `hurts` with a cited source trace = hard veto (no live run until fixed). Stochastic harm = advisory, adds the task to the live set. `inert` on all shapes = blocks live spend until a shape triggers it. **Never promotes.**

## Statistical foundations (read from the papers, 2026-11-18)

Verbatim-read: Miller 2411.00640, tau-bench 2406.12045, ICC 2512.06710, Resolution 2605.30315 (first ~40k chars verbatim, tails model-summarized), GAE 2602.22953, AHE 2604.25850, ReliabilityBench 2601.06112, Reliability 2610.00651 (HTML).

- **Paired SE** (Miller Eq 7): `SE = sqrt(Var(d)/n)`, `d_i = A_i - B_i`; equals `sqrt(SE_A^2 + SE_B^2 - 2 SE_A SE_B corr)`. Unpaired (Eq 5) ignores the correlation: this is the whole pairing win.
- **Clustered SE** (Eq 4): add `(1/n^2) sum_c sum_i sum_{j!=i} (s_ic - sbar)(s_jc - sbar)`; up to ~3x naive on DROP. Our tasks sharing fixtures/tools are clusters; the gate's pooled SE must be checked for this (S3).
- **K resamples per question** (Miller Sec 3): `Var(mu) = (Var(x) + E[sigma_i^2]) / n` with `Var(s_i) = sigma_i^2 / K`: average runs within task first, unit of analysis = task. Do NOT pool all K*n answers (the paper calls the pooled SE inconsistent).
- **Power** (Miller Eq 9): `n = (z_{a/2}+z_b)^2 (w^2 + sA^2/KA + sB^2/KB) / delta^2`. Binary paired (Resolution Eq 3-6): `N* = ((z+z) sigma_D / |delta|)^2`, `sigma_D^2 = pA qA + pB qB - 2 rho sqrt(pA qA pB qB)`, `MDE = (z+z) sigma_D / sqrt(N)`. Paired N* is a median 2.15x smaller than the unpaired formula. **Resolution** `q = N / N*`; `q >= 1` iff `|T| >= ~2.80` at (0.05, 0.8). Size at ~1.2 N*, not N* (empirical power 0.83 at N*, 0.89 at 1.2 N*). Never judge significance by power at the observed effect.
- **Exact McNemar** on discordant pairs (b, c); the test conditions on b+c; if b-c is near 0 the required N explodes. Report b and c with every verdict. (GAE never states exact vs chi-square; use exact.)
- **pass^k** (tau-bench Sec 3): `mean over tasks of C(c,k)/C(n,k)` (c = successes in n trials). pass@k is `1 - C(n-c,k)/C(n,k)`. ReliabilityBench defines pass^k but gives no estimator and measures only k=2.
- **ICC(1,1)** (2512.06710): `ICC = sb2 / (sb2 + sw2)`; one-way random effects; thresholds >=0.75 good, 0.50-0.75 moderate, <0.50 poor; aim `SE(ICC) <= 0.03`. `Var(mu) = sb2/n + sw2/(nT)`: at fixed budget more tasks beat more trials until tasks run out. The paper says T>=5 "substantially stabilizes" means and ICC converges at 8-16 trials (structured tasks) or >=32 (complex reasoning): our k=5 is the floor, not a comfortable n. ICC assumes binary scoring.
- **Reliability paper** (2610.00651): leaderboard-scale GT model; no seed facet, no runs-per-task guidance, run noise lives in the residual. Do not cite it for rerun-vs-task noise; use ICC (above) for that.
- **Caveat on the "8-10pp is noise" claim** (GAE App F): a one-sample Wilson half-width at n=100, not a paired difference. Our paired noise comes from discordant counts: `Var(d) = [(b+c) - (b-c)^2/n] / n^2`.
- **AHE decision rule** (Alg 1): promote iff `Pass@1(T_t) > Pass@1(H_best)`: no margin, no CI, no repeats, selected on the reporting tasks (selection bias; paper's own ablation sums +11.1 vs full +7.3, "non-additive"). Useful ideas we adopt: (a) edits carry predicted fixes and risk tasks, next round scores them (our pre-registered predictions + proximal metric); (b) regression = fails in >=2 of k reruns after passing in >=2 of k baseline reruns, as a veto; (c) measure the noise floor by rerunning the baseline k times; (d) Benjamini-Hochberg across mechanisms tested in one batch; (e) select winners on held-out tasks, not the reporting tasks. Their regression prediction is barely above chance, so keep the explicit veto.
- **Not established anywhere I could read**: a counterfactual prefix-fork protocol, a scripted-provider simulator, small-n (n<=5) coverage guidance, or near-0/1 binary guidance. Treat these as our own claims to prove (S5/S6).

## Spike results so far

- **S6 PASS (zero-token mock tier feasible).** `.withReplayLLM(layer)` takes a scripted `Layer<LLMService>`; `executeReactive` + `buildRunEnvelope({harness})` gives a per-arm config with no env flag. `policyLLMLayer(model, seed)` routes by request purpose (immune to the classifier eating text-first scripts), records requests, counts tokens from the recorded request. **Real find, zero tokens:** with inputs named in prose (no filename token) `leanFinalTurn` fires after one read and accepts a tool-less "I still need the second report" as final: deterministic HURTS (2 turns, unsolved vs off solves in 3). Named files: neutral, -8.7% input tokens. Prefix-fork is feasible by call index only; replay is blind to harness state and `llm-exchange` records only `toolSchemaNames`. Follow-ups: request-size helper in `llm-provider/src/testing.ts`; `completeStructured`/`getModelConfig` in `makeReplayLLMLayer`; `check-cross-cutting.sh` forbids `provideTestEnvelope` in production src (a real `run-shape.ts` needs a gate allowance or lives under tests: owner decision).

- **S3 REDESIGN (not kill)** (`wiki/Research/Spikes-2026-11-18-measurement/S3.md`): 24 comparisons rebuilt from per-cell JSON (ledger has aggregates only; labels for just 6). Accuracy non-inferiority resolved on **0 of 24** (trigger <15%); every v2 non-`need-more-cells` verdict was a `reject-veto-pending`. v2 gives pth no efficiency credit (token ratio 0.85 [0.47,1.57]: one task, todo-heavy, carries the win; tokens per solved run 0.61/0.67 shows it). lft is rejected only via the unreplicated per-task veto (CI path RD -53pp [-157,+50]). **Correction to audit 01:** on real data v1 A/A false reject is 0-5%, not 19-25% (that was simulated); v1 is `underpowered` 100% on k=5 halves; v2 false reject 0-5% but says `need-more-cells` 95-100%. Clustered/naive SE for a single arm median 2.07 (20 arms); for the arm difference <1 when effects are homogeneous, 1.47 when heterogeneous (lft gemma). Median pass^5/pass^1 = 0.80 (cogito loses most). ICC(1) median 0.80 (MSB/MSW form); per tier 5-9 of 12 tasks are always-pass/fail, only 3 discriminative. Run-index McNemar pairing is arbitrary (runs not seed-paired). Veto at k=5 without the automatic solo rerun is unsafe (falsely flags a known-neutral comparison).
- **S4 PASS**: 2,866 traces resolve; 85 mechanism keys, 57 (67%) fire in <5% of cells. "Fired" is not "acted" (pth's proximal trigger = a turn with >=2 independent calls needs a raw-event predicate). Whole-suite +3pp needs effect-given-trigger 70-614pp for default mechanisms firing <5%: whole-suite accuracy cannot decide them. Exit gate is the high-frequency mechanism (55%). No trace rows for bat-*/fam-* comparisons. 5 of 11 predictions missed (pth efficiency flip, dispatcher_early_stop ending 3.8% not >=30%, etc.).
- **Design consequence.** Accuracy non-inferiority at our n is honest but undecisive; decisiveness must come from other evidence classes: (1) efficiency as primary, measured as tokens per solved run with a per-task heterogeneity flag; (2) zero-token deterministic shapes (S6) for harm; (3) proximal-trigger predicates + trigger-conditioned prefix-fork probes for mechanisms that rarely fire; (4) accuracy reported as an interval plus "need N" with a stratified exact/permutation CI (t with df 0-2 on 1-3 discriminative tasks is meaningless); (5) pre-registered proximal-trigger predicate per mechanism, read by the census.

## Order and acceptance (revised)

1. Phase Z core (provider gaps, `policy-model`, 5 shapes, `matrix`) plus Phase 0.1-0.3 and 0.7 (cheap instrument fixes) in parallel (disjoint owners).
2. Phase 0.4-0.6 (honest-decline label, attribution, scorers; rescore saved data, `scorerVersion`), trigger census + seed pairing.
3. Gate v2 (revised rules 4-8) with its simulated A/A + power acceptance, then receipts dry-run diff, then Tier 1 smoke and prefix-fork probes.
4. Simulator calibration against pth and lft, then stochastic tier.
Each step: `bun run repo verify <pkg>`, before/after table on saved data, ledger entry. No default-on change is judged by v2 until the dry-run diff is published and the owner ratifies the policy.
