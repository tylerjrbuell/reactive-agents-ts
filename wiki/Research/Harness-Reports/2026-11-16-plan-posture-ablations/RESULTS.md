---
type: research
status: complete
created: 2026-11-17
tags: [ablation, plan-posture, planToolCatalog, planBudget, wrapUpReserve, planRecon, leanThinking, substrate, local-models, verdicts]
---

# Plan-posture ablation campaign: results and verdicts

Protocol (decision rule fixed before any cell): [[PROTOCOL]] (`PROTOCOL.md`). Run log: `RUNLOG.md` (one line per driver invocation). Raw per-cell data: `raw/*.json` (623 cells incl. 3 voided; trace facts per cell; full traces stay in `/home/tylerbuell/campaign-traces/plan-posture/traces/`, outside the repo). Gate reports and the gate-written ledger: `gate/` (`gate/improvement-ledger.json`, 11 entries, separate from the repo-wide ledger). Driver and analysis copies: `tools/*.txt`. Machine-readable comparison dump: `analysis-cmp.txt`.

Window 2026-11-16 23:20 to 2026-11-17 07:20. Two tiers: `qwen3:latest` (8.2B, thinking) and `cogito:14b` (14.8B). Local Ollama only, one process on the GPU at a time. HEAD `73b05b173`; substrate arm = HEAD + the uncommitted diff snapshotted at 23:35 (sha256 `141b5b8a...236509f`, in `tools/substrate-snapshot.diff.txt`). The working tree may have moved since.

## Verdicts

| # | Mechanism (default today) | Verdict | One-line reason |
|---|---|---|---|
| M1 | planToolCatalog (ON) | OPT-IN-ONLY (no evidence default-on is justified; no harm seen) | +5.6pp / +11.1pp, both within noise; billed tokens +10.9% / +8.0%; gate `opt-in` |
| M2 | planBudget (ON) | OPT-IN-ONLY, lean REWORK on cost | fires in 11% of natural cells, 100% of tight cells; no accuracy lift (-2.5 / -4.2pp); +15% / +36% billed tokens when it fires |
| M3 | wrapUpReserve (OFF) | INCONCLUSIVE (not exercised) | fired in 1 of 12 cells in the arm built to trigger it, 0 elsewhere; gate voided it (A/A). Keep OFF |
| M4 | planRecon (OFF) | OPT-IN-ONLY (keep OFF) | recon task at ceiling (9/9 both arms), so accuracy cannot show lift; +5.6% / +7.3% LLM calls, +7.8% / +10.2% tokens |
| M5a | leanThinking (OFF) | OPT-IN-ONLY at best (no support for default-on) | -11.1pp on both tiers (within noise); qwen3 calls +14% |
| M5b | budgetAnswerTurn (OFF) | INCONCLUSIVE (not exercised) | 0 no-tool answer turns in 31 cells; gate voided it (A/A) |
| M5c | auto-tick / bookkeeping refund (ON, no flag) | NOT MEASURABLE | no flag in `harness-flags.ts`; needs a source seam (follow-up) |
| M6 | plan-producer substrate (uncommitted) | NO REGRESSION DETECTED; no lift claim | plan posture -5.6 / -11.1pp (noise-level, see section Noise); blueprint +5.6 / +11.1pp; plan-execute-reflect 0.0 / 0.0pp (floor on cogito) |
| M0 | plan posture vs direct run (explicit API) | informational | accuracy -2.1 / +5.6pp (noise); LLM calls +78% / +64%, tokens +95% / +68% |

No mechanism met the default-on bar (lift >= 3pp above the 1.96-sigma band in 2 tiers, tokens <= +15%). That was close to guaranteed by power (see below), so "OPT-IN" here means "no evidence", not "evidence of no effect". No mechanism was REWORK under the strict rule except one false alarm explained below.

## Power and noise (read this before trusting any number)

- n per arm per tier on the natural family is 18 (6 tasks x 3 runs). Sigma on a 50% rate for a two-arm difference is about 16pp. A 1.96-sigma promotion therefore needs a lift of roughly 31pp on a tier. Any single positive number below is within noise.
- Null-equivalent controls exist: `noBudget` and `wrapUp` on the natural family never fired the mechanism (plan_budget_raised in 2 of 18 cells per tier; wrap-up reserve 0). They are A/A arms. cogito natural accuracy, runs 0-2: D 10/18, noCatalog 8/18, noBudget 8/18, wrapUp 7/18, lean 8/18, wt-D 8/18, recon 8/13, answerTurn 8/13. So the D reference is the high draw (about +11pp over the A/A arms). Every "candidate vs D" comparison on cogito inherits about -11pp bias, and every "D as candidate" comparison (M1, M2) inherits about +11pp. The gate's own run of `wrapUp` vs D on cogito printed REJECT (-16.7pp, a tier regressing beyond 1 sigma) and its own VOID line (mechanism fired in 0 runs): a pure false positive of the 1-sigma reject band at n=18. Do not read that REJECT as evidence against wrapUpReserve.
- Tasks are constructed, deterministic file tasks (fixtures and graders in `tools/driver.ts.txt`), not the frozen H3 set. The `@4` family (maxIterations forced to 4, 4 tasks) is built to trigger planBudget; it is a mechanism-trigger test, not a sample of real usage. Several tasks sit at the model floor (cogito: pp-coins, pp-inventory, pp-merge fail in both arms), which limits headroom.
- Two tiers only (the brief asked for 2). A third tier was not run.

## Per-mechanism evidence

Lift = candidate minus reference, pp. "tok" = mean billed tokens per cell. Gate = `rax eval gate` decision (reports in `gate/`).

### M1 planToolCatalog (reference: catalog OFF, candidate: D, ON), natural family, runs 0-2
| Tier | n | acc OFF -> ON | lift | calls | tok | gate |
|---|---|---|---|---|---|---|
| qwen3:latest | 17/18 | 0.61 -> 0.67 | +5.6pp (sigma 16.0) | 5.17 -> 5.44 (+5.4%, paired CI [-0.39, 1.11]) | +10.9% | BELOW |
| cogito:14b | 18/18 | 0.44 -> 0.56 | +11.1pp (sigma 16.6) | 5.06 -> 5.39 (+6.6%, CI [-0.06, 0.89]) | +8.0% | BELOW |
Aggregate gate: OPT-IN (8.3pp, 9.5% billed tokens). Not measured: whether plan steps got more correct `tool:` hints (the mechanism's own target). A step-level metric would be the sharper test.

### M2 planBudget (reference: OFF, candidate: D, ON)
| Family | Tier | n | acc OFF -> ON | lift | calls | tok | trigger |
|---|---|---|---|---|---|---|---|
| natural | qwen3 | 18/18 | 0.67 -> 0.67 | 0.0pp | +6.5% | +5.7% | 2/18 cells |
| natural | cogito | 18/18 | 0.44 -> 0.56 | +11.1pp (A/A bias) | +2.1% | +2.5% | 2/18 cells |
| tight (maxIter 4) | qwen3 | 17/16 | 0.41 -> 0.38 | -3.7pp (sigma 17.0) | +16.9% (CI [0.44, 1.0]) | +14.9% | 16/16 |
| tight (maxIter 4) | cogito | 24/24 | 0.29 -> 0.25 | -4.2pp (sigma 12.8) | +28.9% (CI [1.0, 1.38]) | +36.0% | 24/24 |
When the budget raise fires it adds iterations and tokens and did not turn failures into passes: the failing tight tasks fail on model grounds (floor), not on iteration starvation. Gate (tight, all runs): OPT-IN, -3.3pp, +25.7% billed tokens, over the 15% overhead bar. Verdict: no evidence for default-on; the token cost when it triggers exceeds the bar. Recommend the owner decide between opt-in and reworking it to raise only when the run is making progress (steps ticking), not on plan length alone.

### M3 wrapUpReserve (reference: D, candidate: wrapUp ON)
Detector: an execute-posture think call with an empty tool list (the reserve ships a no-tool answer turn). Counts: natural wrapUp arm 0 of 35 cells; tight wrapUp arm 0 of 44; tight with budget raise OFF + reserve ON (new arm `nbWrapUp@4`, built so the budget actually runs out) 1 of 24 (qwen3 one cell). cogito finished every execute run in at most 3 think calls, so the budget was never exhausted. In that arm: qwen3 33% -> 50% (+16.7pp, sigma 19.8), cogito 25% -> 33% (+8.3pp), calls +2.0% / 0.0%, tokens -1.4% / -1.1%; gate OPT-IN, not evidence (1 activation). Verdict INCONCLUSIVE; keep OFF. To test it you need a task where the model really consumes the budget before answering.

### M4 planRecon (reference: D, candidate: recon ON)
| Slice | Tier | n | acc | calls | tok |
|---|---|---|---|---|---|
| pp-recon only (runs 0-8) | qwen3 | 9/9 | 1.00 -> 1.00 | 6.00 -> 6.33 (+5.6%, CI [0.0, 0.89]) | +7.8% |
| pp-recon only | cogito | 9/9 | 1.00 -> 1.00 | 6.11 -> 6.56 (+7.3%, CI [0.11, 0.78]) | +10.2% |
| all 6 tasks (runs 0-2) | qwen3 | 18/12 | 0.67 -> 0.58 | -3.6% | -16.7% |
| all 6 tasks | cogito | 18/13 | 0.56 -> 0.61 | +1.3% | +1.6% |
Recon fired: qwen3 plan-finding in 18/18 recon-arm cells, cogito 6/19. The recon fixture does not need recon: D solves it 9/9 because the execute phase reads `sites.json` itself. Verdict: OPT-IN-ONLY, keep OFF; the lift question is unanswered because the task is at ceiling. A fixture where the plan itself is wrong without the lookup (an id used in an argument checked at plan time) is needed. recon qwen3 had only 12 of 18 natural cells valid for the gate (UNDERPOWERED there).

### M5 execute levers (reference: D)
- leanThinking: qwen3 0.67 -> 0.56 (-11.1pp), cogito 0.56 -> 0.44 (-11.1pp), calls +14.3% / -2.1%, tokens -6.7% / -2.0%. Gate OPT-IN (-11.1pp, within noise; negative on both tiers, partly the D bias). No support for default-on.
- budgetAnswerTurn: qwen3 0.67 -> 0.61, cogito 0.56 -> 0.61 (13 valid); calls -5.1% / -4.4%, tokens -11.1% / -6.4%. 0 fires, so these are A/A numbers. Gate voided it. INCONCLUSIVE.
- auto-tick on named-tool success and bookkeeping-iteration refund: no flag, not ablatable.

### M6 substrate (reference: worktree HEAD, candidate: HEAD + uncommitted snapshot)
| Path | Tier | n | acc | calls | tok | gate |
|---|---|---|---|---|---|---|
| plan posture (`agent.plan` + `execute`) | qwen3 | 18/18 | 0.67 -> 0.61 (-5.6pp) | 5.44 -> 4.94 (-9.2%, CI [-1.17, -0.06]) | -15.4% | OPT-IN |
| plan posture | cogito | 18/18 | 0.56 -> 0.44 (-11.1pp) | -2.1% | -1.5% | OPT-IN |
| blueprint strategy | qwen3 | 18/18 | 0.67 -> 0.72 (+5.6pp) | +1.6% | -1.6% | OPT-IN |
| blueprint strategy | cogito | 18/18 | 0.06 -> 0.17 (+11.1pp) | +4.1% | +8.5% | OPT-IN |
| plan-execute-reflect | qwen3 | 18/18 | 0.83 -> 0.83 (0.0pp) | +4.2% | +6.9% | UNDERPOWERED |
| plan-execute-reflect | cogito | 16/18 | 0.00 -> 0.00 | -4.3% | -1.4% | UNDERPOWERED |
The plan-posture dip equals the D-vs-A/A bias (D was the high draw), so there is no sign of a regression distinguishable from noise on either tier or path. cogito is at the floor on both strategies (0 to 17%), so the substrate cannot be judged there. The substrate is not a toggle; the lift rule does not apply. Reading: safe to land on this evidence for "does not obviously regress", with no lift claim. The planning arg-grounding / completion pieces it adds were not exercised by tasks designed to need them (no plan-time arg-error task).

### M0 plan posture vs direct run (informational)
qwen3 0.69 -> 0.67 (-2.1pp), cogito 0.50 -> 0.56 (+5.6pp). LLM calls +77.8% / +64.4%, billed tokens +95.3% / +67.8% (paired call difference CIs exclude 0). On these tasks the plan -> execute pair costs about 1.7x to 2x for no measurable accuracy gain. Plan posture is explicit API, so no default is at stake, but the cost is worth stating in the guide.

## Strategy observations (not a default question, for the reasoning warden)
cogito:14b scores 0/16 on `plan-execute-reflect` and 1/18 on `blueprint` (HEAD) for the same tasks it solves 44-56% under plan posture and 50% direct; qwen3:latest scores 83% on plan-execute-reflect, 67% on blueprint. cogito's strategy runs end quickly with wrong files, not with errors. Worth a trace read.

## Instrument notes and honesty
- Arms are env flags; each cell's `run-started.config.mechanisms` was read back from the trace and matched the arm (planToolCatalog/planBudget/planRecon/wrapUpReserve/leanThinking/budgetAnswerTurn recorded per run). `numCtx` was 32768 (profile-sourced) on both tiers in every pilot trace, so `qwen3:latest` (not in the static capability table) did not run at the 2048 fallback.
- The driver builds the agent through the public builder (`agent.plan` then `agent.execute`), not the bench `runSession`; tasks are mine, not H3. The `@4` arm forces `withMaxIterations(4)` through a wrapper that patches the builder prototype in-process (`tools/driver2.ts.txt`).
- Foreign Ollama traffic: `bun test apps/cortex/server/tests` (another agent) posted hundreds of `/v1/systemone` requests and loaded `nimble:latest` several times (first seen 23:18-23:21 and 23:30). Detection: journal lines for `systemone` / HTTP 503 per invocation, cell trace windows intersected with request timestamps; 3 cells (D qwen3 first pass) voided and re-run. Afterwards 0 foreign requests overlapped any cell. The RUNLOG "foreignAtStart" field often lists my own previous model (Ollama swap), ignore it.
- 623 cells, 3 voided, 0 inconclusive, 0 hard timeouts (a few execute-phase timeouts in the first qwen3 D cells show as `EXECERR` in the log; those cells are scored 0 and kept).
- Cell cap 200 s, per-call run timeout 100 s. Workspace under `/home/tylerbuell/campaign-traces/plan-posture/work`, not tmpfs.
- Not done: computeOffload resume (strong tier). The campaign used the whole window; per `RESULTS-OFFLOAD.md` the blocker is code-execute reliability (27 of 31 A2 calls failed), so reporting rather than running was the right use of the GPU. Third tier, noCatalog/noBudget replicates, and a step-level tool-hint metric were also not run.

## Follow-ups for domain wardens (not fixed here)
1. reasoning-warden: planBudget raise adds +15% to +36% tokens when it fires with no accuracy return on these tasks. Consider gating the raise on step progress, or default OFF until a task shows starvation being fixed by it.
2. reasoning-warden: add a plan-time metric (tool hint correctness, arg errors caught at plan time) so planToolCatalog and the substrate's arg-grounding can be ablated on what they actually change; accuracy alone cannot resolve them at n=18.
3. reasoning-warden: wrap-up reserve and budget answer turn never fired in 150+ runs; runs end by dispatcher-early-stop or end_turn first. Need a trace event for "reserve fired" (today the only signature is an empty-tool think call) so activation can be counted by the gate.
4. reasoning-warden: seeded-plan auto-tick and bookkeeping refund (commit `d2620792e`) have no flag; if an ablation is wanted, they need a kill flag.
5. harness-warden / test owners: tests that call a live Ollama (`apps/cortex/server/tests`) contaminate benchmark windows; run them with a fake provider or in a different window.
6. docs: `apps/docs/.../plan-then-execute.md` says the plan tool catalog ablation is "still pending". It ran: no measurable lift, +8 to +11% tokens, still within noise. Wording should say "no measured lift".
7. Housekeeping for the parent: two worktrees remain, `/home/tylerbuell/pp-head` and `/home/tylerbuell/pp-wt` (remove with `git worktree remove --force <path>`), driver and traces in `/home/tylerbuell/campaign-traces/plan-posture/`. The repo-wide `improvement-ledger.json` was NOT touched (brief paths); the 11 gate entries are in this directory's `gate/improvement-ledger.json` and can be merged by the owner if wanted.
