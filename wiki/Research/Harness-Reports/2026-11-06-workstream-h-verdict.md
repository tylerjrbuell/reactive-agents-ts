---
type: experiment
status: complete
created: 2026-11-06
tags: [harness, h3, long-horizon, verdict, workstream-h, plan9, activation-counts]
---

# Live verdict: Workstream H fixes (2026-11-06)

This is a live before/after check of the Workstream H fixes that landed today with zero-token verification only. Code under test: `37e1f3912`. HEAD moved to `eda338764` during the run. The commits in between touch only `apps/cortex` and docs (`git diff 37e1f3912 eda338764 -- packages` is empty), so every cell ran the same package code. `git status --short packages` was empty before every chunk. `reasoning` and `reactive-intelligence` were built at the start.

- **Models:** local Ollama, `qwen3:4b` and `cogito:8b`.
- **Cells:** 54 of 54 ran, and none was inconclusive.
  - H3 suite: `h3-todo-heavy`, `h3-plan-only`, `rw-7`; k=5 per tier; 150 s per cell.
  - Long-horizon (LH) suite: `lh-debug-green`, `lh-pipeline-stages`, `lh-1`, `rw-4`; k=3 per tier; 240 s per cell for cogito and 360 s for qwen.
- **Brief deviation:** `rw-4` is not in the H3 suite; it is registered only in `LH_TASKS`. It ran in the LH suite, which also matches the lh-a0 before arm.

**Artifacts (tmp, not committed):** `/home/tylerbuell/.claude/jobs/eaddf328/tmp/verdict-h/`
- Results: `h3-{cogito-8b,qwen3-4b}.json`, `lh-{cogito-8b,qwen3-4b}.json`. Traces are under `traces-*`.
- Activation counts: `analyze.ts` writes `act-{before,after}-{h3,lh}.jsonl` and `summ.ts` summarizes them. Extra probes: `strikes.ts`, `withheld-audit.ts`, `rewrites.ts`. All read trace JSONL and spend zero tokens.
- Attribution: `attr-{before,after}-{h3,lh}.{txt,json}` and `cause-*-lh.txt`. The cohort dirs are `corpus/{before,after}-{h3,lh}/` (symlinks to the exact traces).
- Verdicts: `verdict-h3.txt`, `verdict-lh.txt`, `verdict-lh.json`.

## Before arms and SHA gap

| Cells | Before source | SHA | Gap to `37e1f3912` |
|---|---|---|---|
| H3 todo-heavy, rw-7 (k=5 x 2 tiers) | `2026-11-06-94f0-targeted-h3/results-*.json` | `94f0c9ea5` | 139 commits, 83 touching `packages/` |
| H3 plan-only (k=3 x 2 tiers) | `2026-11-06-h3-plan-ref-normalize/results-*.json` | `f3d38c4a1` | 45 commits, 24 touching `packages/` |
| LH 4 tasks (k=3 x 2 tiers) | `tmp/lh-a0/results.json` | `afbac9af7` | 39 commits, 21 touching `packages/` |

No before arm is the parent of a single fix. The H3 before arm especially predates many other changes (`3436229a0`, S2a, the redirect fix and others). Cell-level deltas therefore mix every change in the gap. Only the per-trace activation evidence ties a delta to a specific fix.

**Noise.** Each run is a Bernoulli trial. At k=3 to 5 per cell, the standard error on a pass rate is about 20 to 30 pp. `verdict.ts` reports every pass-rate change below as "within noise", and no solved-count change here is claimable.

## Solved and billed, per tier

| Suite / tier | Before solved | After solved | Before mean billed | After mean billed |
|---|---|---|---|---|
| H3 qwen3:4b | 7/13 | 10/15 | 15,950 | 13,866 |
| H3 cogito:8b | 0/13 | 1/15 | 14,153 | 11,839 |
| LH qwen3:4b | 1/12 | 2/12 | 31,688 | 22,775 |
| LH cogito:8b | 0/12 | 1/12 | 21,509 | 23,211 |
| **All** | **8/50** | **14/54** | | |

LH pooled mean billed tokens: 26,598 before, 22,993 after (-13.6%, from `verdict.ts`).

Per task (after arm; before in parentheses):

| Cell | Solved | Mean acc | Mean billed |
|---|---|---|---|
| qwen h3-todo-heavy | 5/5 (5/5) | 1.00 (1.00) | 12,190 (17,934) |
| qwen h3-plan-only | 5/5 (2/3) | 1.00 (0.67) | 11,650 (9,905) |
| qwen rw-7 | 0/5 (0/5) | 0.20 (0.27) | 17,758 (16,384) |
| cogito h3-todo-heavy | 1/5 (0/5) | 0.40 (0.57) | 11,217 (11,823) |
| cogito h3-plan-only | 0/5 (0/3) | 0.77 (0.67) | 10,869 (21,865) |
| cogito rw-7 | 0/5 (0/5) | 0.07 (0.00) | 13,432 (11,855) |
| qwen lh-1 | 0/3 (0/3) | 0.04 (0.11) | 52,885 (57,772) |
| qwen lh-debug-green | 0/3 (0/3) | 0.17 (0.22) | 9,479 (17,067) |
| qwen lh-pipeline-stages | 0/3 (0/3) | 0.20 (0.20) | 16,787 (29,869) |
| qwen rw-4 | 2/3 (1/3) | 0.67 (0.60) | 11,948 (22,042) |
| cogito lh-1 | 1/3 (0/3) | 0.33 (0.00) | 47,358 (43,520) |
| cogito lh-debug-green | 0/3 (0/3) | 0.33 (0.06) | 26,520 (13,540) |
| cogito lh-pipeline-stages | 0/3 (0/3) | 0.07 (0.07) | 9,916 (15,218) |
| cogito rw-4 | 0/3 (0/3) | 0.27 (0.27) | 9,051 (13,759) |

`cogito lh-1 r2` (`01M6RSRN178NR9W3ZRP2X44PJP`, 16 iterations, 59,144 billed) solved. lh-a0 and the earlier redirect verdict had 0 cogito solves in 24 LH runs.

## Per-fix verdicts

Each activation count comes from the traces of both arms: 50 before runs and 54 after runs.

| Fix | Activation (before → after) | Effect in the activated runs | Verdict |
|---|---|---|---|
| Phantom action requirements (`8b94e51e1`) | `action:create-ticket` in contract: 6/6 lh-debug-green runs → 0/6 (0 of 54 overall) | No false requirement shown to the model. lh-debug-green solves 0/6 → 0/6; cogito mean acc 0.06 → 0.33 | **Lift (truth): fixed.** No solve lift |
| Input file not a deliverable (`8d9d10035`) | `.//abs/pipeline.json` deliverable: 6/6 lh-pipeline-stages runs → 0/6 | No overwrite of the input manifest. Solves 0/6 → 0/6; acc unchanged (0.07 / 0.20) | **Lift (truth): fixed.** No solve lift |
| Offer to continue is not done (`0fe2bb661`) | NEXT_STEP exit-gate denial: 0 → 3 denials in 2 runs (cogito lh-debug-green `01M6RSFF6JAT01K7FJ9VGG327R`, `01M6RSNYTJNEXSYPVQJCSY63FD`). `harness:offer-accepted-as-done` 1 → 0 | Both runs kept working after the denial ("Would you like me to proceed…?"): 19 iterations / acc 0.50 and 13 iterations / acc 0.33, against a before-arm mean acc of 0.06 on that cell. Neither solved | **Lift (mechanism), no solve change.** `verdict.ts`: FIXED for `offer-accepted-as-done` 1→0 |
| Pending-batch drain/record (`d8cab0161`) | `pending_batch`: 0 → 2 runs, both `dropped`, 0 `drained` | (1) `01M6RREBSH68A3Y86WJQCC5BT9` (cogito todo-heavy r4): on the cap, the batch was a `file-read(notes-6.txt)`, not a deliverable write, so it was not drained. The drop was recorded. Acc 0.83. (2) `01M6RTDJF9N76BWRA7W14ER053` (qwen lh-1 r0): `file-write(findings.json)` dropped by a redirect stop; the call was identical to two failed calls | **Record: works** (0 silent drops among attributed drops). **Drain: void** (0/54 fired) |
| RI cleanup + R1-R3 (`5320b8727`) | S2a stand-down `guard:ri-early-stop:block`: 2 fires in 1 run (`01M6RREB…`). Near-cap RI terminates in H3: 5 runs → 2. Redirect: before 2 runs / 5 stops / 0 nudges; after 1 run / 1 nudge then 2 stops | R1 held: the after-arm escalation (`01M6RTDJ…`) was on byte-identical canonical args (stable key compare, keys reordered). Corrective batches dropped by the redirect: 2 → 0. R3: switch requests 0 → 0; `switching_exhausted` 0 → 0 | **R1 and R2: works as designed.** S2a stand-down fired once and the run still hit the cap. **R3: void** |
| repetitionGuard counts only calls that ran (`3e4e72d29`) | Repetition text on a refused target: 0 → 0. Tool-gate blocks: 1 run each arm | No refused-target case arose. **But:** repetition text appears in 4 after-arm runs and 0 before. 2 of them block a **corrective** write (see N2) | **Void** for the fix's own case. Exposes N2 |
| Unavailable-tool hint (`bdbda3473`) | "Tool call not executed": 0 → 0 runs (no off-surface tool name in 54 runs). Strike-2 instruction visible on the tools-withheld turn: 1/12 before → 0/6 after | The new strike-2 text never reached a model in this sample, because the ICS steer replaces it (N1) | **Void** (hint). The strike-2 text change is **void by defect N1** |
| Recovery alternates (`180b97f77`) | "Try an alternate path now: code-execute" after a `file-read` failure: 1 run (4×) → 0. "Retry X with corrected arguments": 1 → 5 runs | The text was replaced as intended. No outcome is attributable | **Activated, no measurable outcome change** |
| Recall hints (`1946c4f8c`) | A `recall(` hint while recall was off the surface: 0 → 0 | n/a | **Void** |
| Tool descriptions and provider guidance (`c3151a309`, `bd74c7881`, `668917537`, `6e16ba985`) | Static text, present on every run. The new `[Recovery guidance: … If the error points at an argument, fix it …]` wording is visible after | Not separable per run | **Not measurable** in this design |

**`verdict.ts` output:**
- H3: `SHIFTED · harness:premature-stop 2→0` and `SHIFTED · harness:loop-after-work 3→0`. Pass 7/26 → 11/30 (+10 pp, within noise). New harness reasons: `harness:evidence-missing 0→1`, `harness:tool-call-dropped 0→1`.
- LH: `IMPROVED · harness:tool-call-dropped 2→1` and `FIXED · harness:offer-accepted-as-done 1→0`. Pass 1/24 → 3/24 (+8 pp, within noise). Mechanism `pending_batch` fired 0/24 → 1/24.
- LH activity changes: `requirement:action-required` 6 → 0, `loop_resolution:block` 9 → 2, `exit_gate:block` 13 → 5.

## Attribution with the fixed rules (`rax-diagnose attribute --all`)

| Arm | Runs | Failed | harness | model | env | unattributed |
|---|---|---|---|---|---|---|
| H3 before | 26 | 19 | 5 (premature-stop 2, loop-after-work 3) | 13 | 1 | 0 |
| H3 after | 30 | 19 | 2 (evidence-missing 1, tool-call-dropped 1) | 17 | 0 | 0 |
| LH before | 24 | 23 | 4 (tool-call-dropped 2, evidence-truncated 1, offer-accepted-as-done 1) | 18 | 0 | 1 |
| LH after | 24 | 21 | 1 (tool-call-dropped 1) | 20 | 0 | 0 |

After-arm model reasons (54 runs): had-evidence-wrong-output 13, evidence-not-gathered 13, ignored-guidance 6, fabrication-vetoed 3, never-engaged 2.

## Next harness reasons, ranked (for the next cycle)

Attribution now finds only 3 harness runs in 54. The trace audit found two live harness defects that attribution does not label (N1 and N2). Both rank above the attributed reasons.

### N1. On the tools-withheld turn, the model is told to call a tool and never sees the plain-text instruction

`runIcsNudgeStep` replaces `pendingGuidance` with the ICS steer and keeps only `toolUnavailable`: `packages/reasoning/src/kernel/loop/iterate-guard-seams.ts:102-105`. The strike-2 `errorRecovery` instruction ("Do NOT call a tool… answer in plain prose", `unresolved-tool-call.ts:178`) is dropped.

On the withheld turn the model therefore receives `Guidance: Now call http-get with the appropriate arguments.` with zero tool schemas.

- **Frequency:** 18 withheld turns across both arms. The instruction was visible in 1 of 18. A "Now call X" steer was visible in 16 of 18.
- **Runs ended by it:** 2 after-arm runs ended `tool_call_unresolved` at strike 3: `01M6RSH4SCMTHQ5CBQRMJRFT77` (cogito rw-4 r1) and `01M6RSY0HEPYDCY99EFH7Y0BZR` (cogito lh-pipeline-stages r2). Attribution labels both `model:never-engaged`.
- **Why the before arm looks better:** it had 0 strike-3 endings in 11 withheld runs. It recovered only because the pseudo-code text extractor happened to parse the reply (`dialect: pseudo-code`, `01M6REK7BVNFRY0CMH6STM1WVM`).
- **Fix direction:** the ICS step must not steer toward a tool call when `shouldWithholdTools(state)` is true, and it must merge (`contributeGuidance`) rather than replace.
- **Owner:** kernel-warden.

### N2. repetitionGuard blocks a corrective write

Two after-arm runs have a write blocked with "You have already called file-write N times", where the write would have corrected a prior one:

- `01M6RTNDZCRZCR2RZBDPXWWEET` (qwen lh-pipeline-stages r1). `by-region.json` was refused as invalid JSON at iteration 2. Its corrected rewrite at iteration 4 was blocked, so the target was never written.
  - The converging-retry carve-out reads the last call to the *tool* (`report.md`, which succeeded), not to the *target*: `packages/reasoning/src/kernel/capabilities/act/guard.ts:479-482`.
- `01M6RR36CXEAE3C9F031D5KKN0` (cogito h3-todo-heavy r0). A blind batch wrote `out-1..6 = 34`. After reading `notes-2.txt`, the model rewrote `out-2.txt` with `84`, and that rewrite was blocked.
  - `file-write` is sequential-only, so the block must come from the stalled-requirement branch, which skips the distinct-arguments carve-out: `guard.ts:454-466`. This branch is inferred from the code path, not traced.

The other after-arm repetition blocks (`01M6RR66XNNNS4B2BW3GVDVW0T`, `01M6RR16XH90YGCHGKYWRDFDX4`) repeat the same wrong content, so those blocks are correct. Also, a guard-blocked call records `tool-call-end.ok=true` with the guard text as its result.

Owner: kernel-warden.

### N3. `harness:evidence-missing` in a plan-execute step

`01M6RRD30G9AJFWE5473Q13ARP` (cogito h3-plan-only r4). The `file-read(inventory.csv)` result is absent from the request of the `low-stock.txt` write step (divergence at iteration 0, seq 3000).

The location is not traced yet; start at `packages/reasoning/src/strategies/plan-execute.ts` step context. 1 run only. Owner: kernel-warden.

### N4. Iteration cap drops a needed read (`harness:tool-call-dropped`)

`01M6RREBSH68A3Y86WJQCC5BT9`: S2a bought one turn, the model used it for the read that `out-6` needs, and the cap ended the run. This is a budget outcome, not a defect. The drain rule only drains deliverable writes, by design. **Build nothing.**

### Instrument faults (my domain, `packages/trace`; not fixed under this brief)

- **(a)** `01M6RTDJF9N76BWRA7W14ER053` is tagged `harness:tool-call-dropped`, but the dropped call was byte-identical to a call that had failed twice. A dropped identical failing retry is not a harness loss. With this corrected, LH-after harness = 0.
- **(b)** The two N1 runs are tagged `model:never-engaged`, but the harness gave contradictory guidance on the decisive turn. Attribution should check guidance against the turn's tool surface.

## Bottom line

- **Fixed (truth):** the phantom action requirement and the input-file deliverable are gone from every applicable run (6 → 0 each).
- **Working in live runs:** offer-to-continue, pending-batch recording, and the R1/R2 redirect activated and behaved as designed.
- **Never fired (void):** pending-batch drain, R3, the unavailable-tool hint, recall hints, and the repetitionGuard refused-target case.
- **Void by defect:** the strike-2 text change (N1).
- **Solve rates:** every tier went up (8/50 → 14/54) and billed tokens went down. All of this is within Bernoulli noise and spread across a 21 to 83 commit gap, so this cycle claims no lift.
- **Next cycle, one fix:** N1 (ICS steer on tools-withheld turns). It is deterministic, it ended 2 runs, and it voids a shipped fix.

## Instrument corrections (2026-11-06, after this verdict)

Instrument faults (a) and (b) above are fixed in `packages/trace`. The tables above keep the original counts. This section gives the corrected counts.

- **(a)** `harness:tool-call-dropped` no longer counts a dropped call that repeats a call which already failed twice with the same arguments. The comparison ignores key order and compares the path by base name. A retry steer (`denied-tool-retry`) that names a tool whose own last call failed is also no longer `harness:misleading-guidance`. That rule had trusted a ledger entry that marks `tool:file-write` satisfied after a failed call, and it was the next rule to match these runs. Code: `packages/trace/src/attribution.ts` (`identicalFailuresBefore`, `ruleMisleadingGuidance`).
- **(b)** New reason `harness:contradictory-guidance`. It fires when the run's last LLM turn is a `think` turn whose request tells the model to call a run tool that the same request offered no schema for, the model names that tool in its reply, and the tool never ran. Code: `packages/trace/src/attribution-guidance.ts`.
- **Pins:** `packages/trace/tests/attribution-retry-and-guidance-faults.test.ts` uses synthetic traces only and includes 4 controls. Before the fix, its 2 fault tests failed: `harness:tool-call-dropped`, and `model:never-engaged` where `harness:contradictory-guidance` was expected. After the fix, all 6 tests pass.

Re-attribution of the same four cohorts (`corpus/{before,after}-{h3,lh}`), per run:

| Arm | Run | Before | After |
|---|---|---|---|
| LH after | `01M6RTDJF9N76BWRA7W14ER053` | `harness:tool-call-dropped` | `environment:tool-failure` (cause fallback `tool-failure/repeated-identical-call`, probable) |
| LH after | `01M6RSH4SCMTHQ5CBQRMJRFT77` | `model:never-engaged` | `harness:contradictory-guidance` (decisive) |
| LH after | `01M6RSY0HEPYDCY99EFH7Y0BZR` | `model:never-engaged` | `harness:contradictory-guidance` (decisive) |
| LH before | `01M6RFRCKH4284VV2GYBDV0WAA` | `harness:tool-call-dropped` | `unattributed`. Same shape as (a): an identical `findings.json` write was dropped after 2 failures |

No run changed in either H3 arm (56 runs).

| Arm | harness | model | env | unattributed |
|---|---|---|---|---|
| LH before | 4 → 3 (tool-call-dropped 1, evidence-truncated 1, offer-accepted-as-done 1) | 18 | 0 | 1 → 2 |
| LH after | 1 → 2 (contradictory-guidance 2) | 20 → 18 | 0 → 1 | 0 |

**Corrections to the text above:**
- "With this corrected, LH-after harness = 0" (fault (a)) does not hold once (b) is also fixed. LH-after harness is 2, and both runs are N1. Attribution now labels N1, so N1 is the top attributed harness reason in the LH after arm. This agrees with the "next cycle, one fix" choice.
- The LH `tool-call-dropped` change is 1 → 0, not 2 → 1. The counts come from the cohort tallies; `verdict.ts` was not re-run.

**Still open:** `01M6RTDJ…` now reads `environment:tool-failure`. The cause map gives the whole `tool-failure` cause to the environment, but here the tool correctly refused invalid JSON and the model resent it unchanged. Splitting `repeated-identical-call` out to a model reason would move the owner for a whole cause class, so it needs its own change and before/after table. It is not part of this correction.
