---
type: research
status: complete
created: 2026-11-07
tags: [harness, spike, feedback-loop, shell-execute, duplicate-guard, workstream-h, rw-7, lh-debug-green, zero-token]
---

# Feedback-loop spike: does "no way to run the tests" cap small-model accuracy? (2026-11-07)

**Question.** Leading hypothesis from [[2026-11-07-leverage-scan]] item 4 and the [[../Ablations/2026-11-07-input-coverage/README|input-coverage ablation]]: `model:had-evidence-wrong-output` (now the largest failure class) persists because rw-7 and lh-debug-green demand passing tests and give the agent no way to run them.

**Answer.** Only partly. The binding constraint is somewhere else:

1. **The dominant shape is unwritten targets, not wrong fixes.** In current-code failures, 58 % of lh-debug-green module slots and 32 % of rw-7 bug slots were never written. Only 20 % / 28 % were written wrong.
2. **Offering a shell does not create a feedback loop.** Models ran tests in 3 of 18 shell-arm runs (all rw-7, whose prompt names `bun test`) and in 0 of 9 lh-debug-green runs. Lift gate: UNDERPOWERED, with the mechanism inert in 15 of 18 runs.
3. **The harness breaks the loop when a model does try it.** `duplicateGuard` replays a prior tool result after the workspace has changed and appends "do NOT repeat. Give FINAL ANSWER". Both repeat `bun test` calls in the A/B were served stale, in 0 ms. Across the corpora it fired in 14 runs. All 14 failed, and attribution blamed the model in every one.

## Method

- **Corpus.** Every benchmark trace in `bench-corpora/2026-11-07/{abl-auto,abl-ic,aoa,verdict-h}`, deduplicated by runId: 406 runs. The owner's trace store was not read. Each run was re-attributed at HEAD (`rax-diagnose attribute --all --json`). `model:had-evidence-wrong-output` (HEWO) has 105 runs: rw-7 42, h3-plan-only 25, lh-1 18, lh-enumerate-audit 10, rw-4 6, lh-debug-green 4.
- **Zero-token workspace replay (`replay.ts`, `permod.ts`).** For every rw-7 and lh-debug-green run (166), the replay rebuilds the final workspace from the task fixtures plus every successful recorded `file-write`. It then runs (a) the checks an agent could run (the visible task tests, plus any test files the agent wrote) and (b) the hidden grader.
  - **Instrument check:** the replayed grader matches the recorded `eval-graded` pass/fail in **166/166** runs.
  - Each slot (an lh module or an rw-7 bug) is then classified as `fixed`, `written-wrong` or `not-written`.
- **Live A/B (`run-shell.ts`, `drive.sh`).**
  - Arms: `base` vs `shell`. The only difference is `shell-execute` (with `bun` allowed) as an available tool on rw-7 and lh-debug-green.
  - Setup: `RA_ACT_OR_ANSWER=auto` in both arms; qwen3:4b, cogito:8b, qwen3:14b; k = 3; 300 s cells; SHA `39cf9a9b5`.
  - The shell arm mutates the tasks in process before hashing, so its results carry their own task hashes (rw-7 `87ea06e4…`, lh-debug-green `fc3921fc…` vs frozen `e56b2991…` / `7e417ec5…`). The frozen suite is unchanged.
  - Predictions were written before the first cell (`PREDICTIONS.md`).
- **Runner change (`39cf9a9b5`).** A task that declares `shell-execute` now gets `withTools({ terminal: { additionalCommands: ["bun"] } })`. No frozen task declares it, so it is inert for existing suites.

## 1. Zero-token classification

### Would running the checks have caught it?

| Task | Failed runs (all cohorts) | Agent-runnable check at exit | Reading |
|---|---|---|---|
| lh-debug-green | 67 | visible tests **red in 67/67** | A check run at exit flags every failure. |
| rw-7 | 76 | **no test written in 57/76**. In the 19 that wrote tests, own tests red in 19/19 | No visible suite. The agent's own tests are not a reliable oracle: they were also red in **9 of the 13 solved runs** that wrote tests (false alarm on correct code). |

The rw-7 pipeline bug is a ceiling for any behavioral check. `real-world.ts:264` documents that the `Promise.all` race is not behaviorally observable under Bun. The hidden test detects it with a `Promise.all` spy. Of the 33 wrong `pipeline.ts` writes, **26 still use `Promise.all`** and produce output identical to the fix. No test the agent would plausibly write can flag them. The pipeline check failed in 40 of the 42 rw-7 HEWO runs.

### What the failures are (current-code cohorts abl-auto + abl-ic, failed runs only)

| Task | Slots | fixed | written-wrong | **not-written** |
|---|---|---|---|---|
| lh-debug-green (49 runs × 6 modules) | 294 | 64 (22 %) | 60 (20 %) | **170 (58 %)** |
| rw-7 (37 runs × 3 bugs) | 111 | 45 (41 %) | 31 (28 %) | **35 (32 %)** |

- **lh-debug-green modal run:** writes `clamp.ts` (module 1 of 6), then ends with a clean final answer. That is 24 of 49 current failures (37 of 67 across all cohorts). `rax-diagnose` labels these `model:evidence-not-gathered`.
- **Fix rate when a module is written:** clamp 48/67, chunk 18/25, dedupe 10/18, duration 9/19, slugify 11/25, median 3/15. Even with full coverage at these rates, a full solve is unlikely (≈ 0.5⁵ for modules 2-6). Expected partial credit would roughly double.
- **rw-7 zero-write runs:** in current cohorts, 3 of 37 failures wrote only test files and no `src/` target. Writing any file credits `tool:file-write`, so the exit gate accepted. This is the write-side twin of DEBT #39 that the input-coverage ablation found on cogito rw-7.

**Classification of the 46 HEWO runs on the test-gated tasks:**

| Class | Count | Evidence |
|---|---|---|
| Partial: some target never written | most | 35/111 rw-7 slots, 170/294 lh slots not written |
| Wrong fix, behaviorally invisible | 26 pipeline writes | still `Promise.all` |
| Wrong fix, a behavioral test would catch it | 31 lh-debug-green + rw-7 slots | e.g. sequential pipeline that drops the state mutation, `median` comparator |
| Misread task / format | 0 observed | no wrong-path writes; 1 run edited a test file |

## 2. Live A/B: shell vs base

| Tier | Task | base acc (runs) | shell acc (runs) | shell runs that used the shell | `bun test` runs | src targets written base / shell |
|---|---|---|---|---|---|---|
| cogito:8b | rw-7 | .67 .67 .67 | .00 .67 .33 | 2/3 | 2 | 3,3,3 / 3,3,1 |
| cogito:8b | lh-debug-green | 0 0 0 | 0 0 0 | 0/3 | 0 | 2,4,6 / 5,5,6 |
| qwen3:4b | rw-7 | .67 1 .67 | .67 0 .33 | **0/3** | 0 | 3,3,3 / 3,0,1 |
| qwen3:4b | lh-debug-green | .50 .17 .17 | .83 .17 .33 | 0/3 | 0 | 3,1,1 / 6,1,6 |
| qwen3:14b | rw-7 | 1 0 .67 | 1 1 1 | 1/3 | 1 | 3,0,3 / 3,3,3 |
| qwen3:14b | lh-debug-green | .17 .17 .17 | .17 .67 .00 (1 aborted) | 0/3 | 0 | 1,1,1 / 1,4,2 |

Lift gate receipt (`gate-dry.txt`):

```
  cogito:8b   33.3  16.7  -16.7pp  +20.1%  BELOW
  qwen3:14b   36.1  70.8  +34.7pp  +70.1%  INCONCLUSIVE
  qwen3:4b    52.8  38.9  -13.9pp   +6.2%  BELOW
  AGGREGATE  -15.3pp · 13.2% billed tok · tiers=3 · PARTIAL
  DECISION: UNDERPOWERED
```

Ledger: booked with `activations: 3` (the shell-arm runs that called `shell-execute`).

**Reading.**

- **Uptake is the result.** 3 of 18 shell-arm runs called the shell. Every cell's per-arm swing is ±33-44 pp, inside the n = 3 band, and is carried by runs that never used the shell: qwen3:4b rw-7 −44 pp with 0/3 uptake, qwen3:14b rw-7 +44 pp with 1/3. Do not credit or blame the shell for these swings.
- **Predictions:**
  - Prediction 1 (uptake ≤ 1/3): confirmed (17 %).
  - Prediction 2 (pipeline check fails in ≥ 80 %): partly. It failed in 7/9 base and 6/9 shell runs (≈ 70 %).
  - Prediction 3 (no lh-debug-green lift without test runs): confirmed (0 test runs).
- **What the 3 shell users saw:**
  - First `bun test`: "No tests found!", because no test file existed yet.
  - qwen3:14b and cogito tried `cd <workspace> && bun test` and were refused: "cd does not persist between calls — the shell already starts in the sandbox root". The refusal is truthful, but the call cost a turn.
  - cogito then wrote `tests/*.test.ts` and re-ran `bun test`. The run got **the stale "No tests found!" result in 0 ms**, plus "[Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete.]". It did this twice. The run scored 0.00. See §3.
- **Tool-surface instrument gap:**
  - On the local profile, `shell-execute` is shipped through tool-index promotion (`think.ts:658-672`, schema with an empty description).
  - But `tool-surface-resolved` reports it as `hidden: lazy-undisclosed` and leaves it out of `callable`.
  - `wire-request.toolsShipped` labels it provenance `user`.
  - Consumers of `tool-surface-resolved` therefore under-report the offered surface.

## 3. New harness defect: `duplicateGuard` serves stale results across workspace mutations

- **Site:** `packages/reasoning/src/kernel/capabilities/act/guard.ts:338-396`.
- **Rule:** it keys on `JSON.stringify({tool, args})` alone. If an identical prior call succeeded, it does not execute the new call. Instead it returns the prior observation plus `[Already done — do NOT repeat. …]`.
- **Missing invalidation:** nothing invalidates the cache when a successful mutating call (`file-write`, `shell-execute`, `code-execute`) lands in between.
- **Effect:** every verify-after-edit pattern gets the pre-edit answer, then a push toward the final answer. The patterns are re-running tests, re-reading a file you just wrote, and re-writing a file another write changed. No `guard-fired` event is emitted, so the trace shows only `durationMs: 0`.

Zero-token count (`stale.ts`). A hit is a replay whose original call was followed, before the replay, by a successful mutation that could change its result:

- A re-read counts if the same path was written in between.
- A write counts if the same path was overwritten in between, meaning the replay drops a write.
- A shell call counts if any mutation happened in between.

| Corpus | Runs | Runs with a dup replay | Dup replays | **Stale after mutation** | Runs with stale replays | Their outcome |
|---|---|---|---|---|---|---|
| 2026-11-07 corpora | 406 | 65 | 187 | **44** (33 file-read, 11 file-write) | **14** | **14/14 failed**, all attributed `model:*` |
| shell A/B | 37 | 2 | 4 | 3 (2 shell `bun test`, 1 file-read) | 2 | both failed |

Why this matters more than its count:

- It fires exactly when a model tries to check its own work. With uptake at 17 %, the count is small today.
- Any feedback-loop mechanism will multiply it: shell, a coding profile, a harness-run acceptance check the model re-invokes, or `inputCoverage` reads after writes.
- It is general, not a model quirk. Any agent that edits and re-checks in the same run is affected.
- The instrument hides it. All 14 runs were blamed on the model.

**Proposed fix (not built).** Track a run-scoped workspace epoch that increments on each successful mutating tool call. Store the epoch with each observation, and let `duplicateGuard` match only calls of the same epoch. That is one condition at the guard, which is the boundary. Emit `guard:duplicate:replay` (with the epoch) when it fires, so the replay shows up in activity and attribution.

- **Red-on-cut pin** (on the `test` provider): read `a.ts`, write `a.ts`, read `a.ts`. The second read must return the new content. On today's code it returns the old content.
- **Owner:** kernel-warden (`packages/reasoning`). Add a matching `harness:stale-replay` attribution rule for harness-warden (`packages/trace`).

## What this says about the parked item and next passes

Ranked by evidence in this spike:

1. **`duplicateGuard` epoch fix: a bug fix, not a new mechanism.**
   - Trigger proven (14 + 2 runs, all failed). Zero-token verifiable on the recorded corpora, because the replay rule is control flow: re-run `stale.ts` and count 0.
   - Lift cannot be promised: of 14 runs, the replay is decisive in an unknown number. It is a prerequisite for measuring any feedback loop honestly.
2. **Per-target write coverage: the parked "in-place fix targets as write requirements".**
   - This spike says it is **not** symptom-chasing. Unwritten targets are the largest slot class on both test-gated tasks (58 % / 32 %).
   - The exit gate accepts done after 1 of 6 listed targets because one write credits `tool:file-write` (DEBT #39, write side).
   - It is also what fixes the input-coverage regression on cogito rw-7, where forcing chased reads while the `processor.ts` write stayed missing.
   - Spike before build: count tasks whose listed write targets are all genuinely required (the false-outstanding risk), reusing the instrument's task-listed-input rule.
3. **A harness-run acceptance check for code tasks with visible tests**, which does not depend on the model choosing to run them.
   - On lh-debug-green it would have flagged 67/67 failures, covering both unwritten and wrong modules. The model never has to run the tests itself, which it does not do (0/9 runs).
   - It does nothing for rw-7 (no visible suite, and the pipeline bug is invisible to behavior).
   - This is the Plan 9 coding-agent profile. Its default-on status needs the lift rule, and fix 1 must land first, or re-checks will be replayed stale.
4. **Shell on the frozen suite: do not refreeze yet.** At 17 % uptake it adds no measurable signal. Keep the in-process arm (`run-shell.ts`) for re-measuring after fixes 1 and 3.

Instrument follow-ups (harness-warden):

- `harness:stale-replay` rule.
- `tool-surface-resolved` should list index-promoted tools as visible/callable.
- `toolsShipped` provenance for promoted tools.
- HEWO should not cover runs that never wrote a `src/` target.

## Files

- Results and scripts: `2026-11-07-feedback-loop-spike/` (`{base,shell}-ab-*.json`, `summary.txt`, `replay.json`, `gate-dry.txt`, `PREDICTIONS.md`, `replay.ts`, `permod.ts`, `stale.ts`, `tab.ts`, `run-shell.ts`, `drive.sh`, `loop.sh`, `sum.ts`).
- Traces: `bench-corpora/2026-11-07/shell-ab/`, which is local and not committed.
- Scripts carry absolute scratch paths from the job directory.
