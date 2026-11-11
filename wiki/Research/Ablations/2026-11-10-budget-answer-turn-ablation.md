---
type: ablation
status: complete
created: 2026-11-10
tags: [ablation, lift-gate, budget-answer-turn, max-iterations, outcome-truth, opt-in]
---

# Ablation: budget answer turn. Verdict: OPT-IN (coded gate), plus an outcome-label defect to fix first

The mechanism shipped default-on in commit `229896252` (`packages/reasoning/src/kernel/loop/budget-answer-turn.ts`, called at `turn-operations.ts:371`). When the next think call is the last one the iteration budget allows, the run holds validated tool evidence, and only the answer is outstanding, that call ships with **no tools**, so the model writes the answer. This note measures it on 3 tiers. Scripts, receipts and results: [2026-11-10-budget-answer-turn/](2026-11-10-budget-answer-turn/).

## Verdict

Coded gate (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`). Ollama tiers are token-free (owner ruling 2026-11-06). Ledger entry 43 in `wiki/Research/Harness-Reports/improvement-ledger.json`. Receipt: `gate-receipt.txt`.

```
  tier                 base    cand      lift       tok  verdict
  grok-4               47.8    53.3    +5.6pp    -22.3%  BELOW
  mimo-v2.6@16384      35.6    43.3    +7.8pp    +10.5%  BELOW
  cogito:8b            27.8    20.0    -7.8pp     -6.5%  BELOW
  AGGREGATE  1.9pp · -6.3% billed tok · tiers=3
  DECISION: OPT-IN · 3 tier(s) · 1.9pp lift · -6.3% billed tok — within the noise floor
```

Sensitivity (not in the ledger): without the two umami cells, whose grader needs 3 facts that a 2-call budget cannot fetch, the gate is still OPT-IN. Lift is grok-4 +11.1 pp, mimo +13.0 pp, cogito −9.3 pp; billed tokens −21.5 %. Receipt: `gate-receipt-sensitivity-no-umami.txt`.

**Recommendation: OPT-IN, and fix the outcome label (defect 1) before any re-gate.**
- No tier clears the 95 % band. Per-cell SE at n = 6 is about 19 to 29 pp.
- No tier regresses significantly. The cogito drop comes from runs where the mechanism did **not** fire: it fired in 7 of 30 cogito runs. On a non-firing run the two arms run the same code, so that drop is noise.
- The flag that makes it opt-in follows the `stableToolList` pattern:
  - `HarnessConfig.budgetAnswerTurn?: boolean`, default OFF (`packages/reasoning/src/harness-config.ts`).
  - Env `RA_BUDGET_ANSWER_TURN=1` through `readFlag` in `harness-flags.ts`.
  - `ResolvedHarness.budgetAnswerTurn?: true`, present only when on.
  - Gate at the single decision point. The first line of `budgetAnswerTurnRecord` becomes `if (input.harness?.budgetAnswerTurn !== true) return undefined;`. That also keeps `budgetAnswerTurnTaken` false, because no record then carries `answerTurnAt` from this path.
  - Record the flag in `run-started.config`.
  - The kernel warden implements this. I do not edit `src` or flip defaults.

## What the mechanism does to user-visible outcomes (not gated; this is the Cortex symptom)

Receipt: `results/outcomes.txt`. n = 30 runs per tier and arm (5 task variants × 6). Kernel outcome status, the caller-visible `success`, and non-empty answers:

| Tier | Arm | completed | partial | failed | caller `success` | non-empty answer | fired | fired + verified | fired, answer turn still emitted tool calls |
|---|---|---|---|---|---|---|---|---|---|
| grok-4 | off | 22 | 0 | 8 | 22 | 22 | 0 | | |
| grok-4 | on | 6 | 24 | 0 | **30** | **30** | 24 | 24 | 0 |
| mimo@16k | off | 7 | 2 | 21 | 7 | 21 | 0 | | |
| mimo@16k | on | 0 | 15 | 15 | **15** | **27** | 27 | 13 | 8 |
| cogito:8b | off | 20 | 0 | 10 | 20 | 30 | 0 | | |
| cogito:8b | on | 10 | 7 | 12 | 17 | 27 | 7 | 7 | 0 |

- The targeted symptom goes down where the mechanism fires.
  - On grok-4, every run returns an answer (30 of 30, against 22 of 30). The 8 off-arm failures are all `max_iterations` with an empty output: the last call went to a tool nobody answered.
  - On mimo, non-empty answers rise from 21 to 27 and caller success from 7 to 15.
- The task-accuracy grader moves less, because a forced answer from thin evidence is often incomplete.
  - umami@mi2: one `get_websites` result. grok answers "your docs site is `a1f3-docs`" and scores 0 on both arms.
- Tokens: billed −22.9 % on grok-4. The last call ships no tool schemas, and a cap-killed tool call is never made. Mimo is +10.5 % (token-free tier), because answer turns that do run write longer outputs.

## Harness defects found (report to kernel-warden / runtime-warden; not fixed here)

1. **A correct answer from the answer turn is labeled `partial`** (kernel terminal path; this is outcome truth).
   - Every fired H3 run with a correct graded answer ends `outcome.status: partial` with `terminatedBy: max_iterations`: 26 of 26 (grok 12, mimo 9, cogito 5).
   - The same correct answers on the off arm end `completed`, with `terminatedBy: controller_early_stop:dispatcher_early_stop` (24 of 24).
   - `rax-diagnose cause` labels every fired correct run `terminal-mislabel`.
   - The fired runs pass the terminal verifier (verified = true). Yet the run still ends through the cap's draft handoff, not as a model-final exit. That makes the module doc's "ends the run as success or ... partial" `partial` every time in practice.
   - This is the main reason grok's `completed` count falls from 22 to 6.
   - Fix at the shared terminal path (pitfall 12): a verified answer-turn reply should end as a model-final exit.
2. **The guard trusts the compiled contract, which can miss requested actions** (kernel; contract compile).
   - `wide-metric` asks "fetch the metric, then file a report ... using the report tool". The compiled contract is only `[{id:"answer"}]`: no requirement for `report_file`.
   - So `contractOutstanding` is empty, the reservation fires, and the model loses the tool it still needed.
   - grok-4: 6 of 6 fired runs never call `report_file`. Each still returns caller `success: true` ("kernel status partial shipped as success: partial-substantive-output").
   - The off arm fails these runs instead: it does not file the report either, because the cap ends the run before the last tool call executes.
   - Net: no less work gets done, but a skipped action now shows as success.
3. **The answer turn does not stop a weak model from calling tools** (mimo, 8 of 27 fired runs).
   - With `toolsShipped: []`, mimo still returns tool calls. The trace shows `tool_call_extracted mixed`, so the text-call extractor parsed them out of the content.
   - In one run it wrote an unrelated answer ("Here's the build — a single self-contained `index.html` with the observatory layout..."), stopping on `max_tokens`. Its prompt held the goal and the tool result (219 tokens in).
   - Hypothesis, not tested: on a tool-less turn the transcript renders earlier calls as `[tool_use:<name>]` text, and the model imitates that.
4. **The mechanism fires when the model would have answered anyway.**
   - On grok-4 H3 the off arm answers on its last call in 12 of 12 runs. The reservation does not check that, so the only effects there are the token saving and defect 1.

## Setup

- **Arms without editing `packages/*/src`.** A Bun preload plugin, `arm-plugin.ts`, serves every `packages/<pkg>/src/**/*.ts` from a frozen copy.
  - The copy was taken 2026-11-10T21:27:50-05:00 at HEAD `76f5fe1dd` (1,551 files). It lives in `~/.reactive-agents/ablations/2026-11-10-budget-answer-turn/snapshot`. The working tree's `llm-provider` diff is included, and it is the same in both arms.
  - `off` adds `if (state !== null) return undefined;` as the first line of `budgetAnswerTurnRecord`. The patch must match exactly once, or the process aborts. The plugin logs `target-loaded=1` on exit.
  - HEAD moved during the run (other wardens committed `e3ad4b4e8` and later). The arms are pinned by the snapshot. `to-session.ts` takes `ABL_SNAPSHOT_SHA` for that reason.
- **Tiers.**
  - `grok-4` (xai, static).
  - `mimo-v2.6` with `numCtx` 16384 (capability primed from `/api/show`).
  - `cogito:8b` (H3 static tier).
- **Tasks.** The live-census firing variants (below), with prompts, fixtures and graders unchanged. The budget is overridden in memory: `--max-iter` for the custom driver, `task.maxIterations` for H3.
  - `umami-explore@mi2`, `umami-explore@mi3`, `wide-metric@mi2`: custom tools. The task definitions are copied from the 2026-11-10 family-disclosure ablation.
  - `h3-continuation@mi2`, `h3-exact-value@mi2`: frozen H3.
- **Runs.** n = 6 per cell, arms alternated per run index, 180 measured cells. 0 timeouts, 0 provider faults in the final matrix.
- **Tool surface per arm** (`results/tools-shipped.txt`, wire-request `toolsShipped`). Turn 0 is identical across arms in every cell: no tool-surface confound. On the last turn, fired runs ship 0 tools. Off runs ship the turn's surface (grok 2 or 12, mimo 2, 20 or 40, cogito 3, 21 or 41).

### Trigger census (before the matrix)

- **Offline, zero-token** (`census.ts`, `census-offline.txt`). 249 recorded root runs from the 2026-11-10 stable-tool-list and family-disclosure ablations.
  - This is an upper bound: it counts runs that reach think call #M with an ok tool result before it, and cannot see `contractOutstanding`.
  - At M = 4: umami 17 of 30, h3-required-tools 16 of 16, h3-plan-only 12 of 17, rw-6 9 of 16, rw-7 14 of 16, wide-metric 0 of 30.
  - At the shipped budgets (8 to 25), 1 of the 249 runs ended on the cap (ab-trap-5). At shipped budgets the mechanism almost never fires on these suites.
- **Live** (`census-live.txt`; mimo@16k, on arm, 1 run per variant, 15 variants). It fires on 5: umami@mi2 and @mi3, wide-metric@mi2, h3-continuation@mi2, h3-exact-value@mi2.
  - It does not fire on rw-2, rw-6, ab-trap-5, h3-todo-heavy or h3-continuation/exact-value at mi3, nor on umami or wide-metric at mi4.
  - rw-2@mi3 is a correct non-fire: an artifact was still outstanding, and the model's last call wrote it.
- In the matrix it fired in 24 of 30 grok runs, 27 of 30 mimo runs and 7 of 30 cogito runs. Cogito usually answers, or asks the user, on its first call.

### Instrument faults (found and fixed during the run; affected cells voided)

1. **`.env` not loaded.** Bun loads `.env` only from cwd, and the first grok pass ran from the ablation dir: 10 cells `llm_error` "no API key". Those cells were deleted. Fix: `--env-file`. The adapter now also voids any provider-fault cell; none remained.
2. **Concurrent tiers deleted each other's fixtures.** `runSession()` sweeps every `.bench-run-*` in cwd at start (`runner.ts:634`, `cleanupStaleBenchDirs`). That deleted a concurrent tier's live H3 fixture, giving 2 ENOENT cells. All 36 H3 cells of that pass were voided. Fix: one cwd per tier. **Bench defect, report to harness-warden:** the sweep should skip dirs held by a live process, or use a per-process prefix.
3. **A cwd outside the repo** broke `git rev-parse` (gitSha `unknown`) and added about 146 s per H3 cell. That pass was voided. Final cwd: `results/traces-cwd-<tier>` (gitignored).
4. Voided data is kept outside the repo: `~/.reactive-agents/ablations/2026-11-10-budget-answer-turn/voided-*`.

## Not proven

- The tasks were chosen because the mechanism fires on them. Budgets of 2 to 3 are artificial. The motivating census is 9 cap-with-evidence runs (6 reactive, 3 sub-pass) out of 533 root runs in 7 days, about 1.7 %. The real-world effect on a full suite is that rate times the per-fire effect.
- Accuracy is a poor measure of "an answer was written". The user-visible effect shows in the outcome table, which the gate does not score.
- Defect 1 lowers the outcome labels, not the graded accuracy. Fixing it would change neither the gate's numbers nor the verdict.
- One run per variant in the live census. Mimo at one context size only.
