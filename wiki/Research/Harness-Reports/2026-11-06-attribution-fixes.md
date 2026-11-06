---
type: harness-report
status: complete
created: 2026-11-06
tags: [attribution, rax-diagnose, instrument, packages-trace, zero-token, had-evidence-wrong-output, tool-surface]
---

# Attribution instrument fixes: I1-I6, three live harness causes, D1/D2

Zero model tokens. This report fixes the six instrument faults in `packages/trace` attribution that [[2026-11-06-evidence-wrong-output-audit]] found. It also fixes two faults from the tool-surface spike (`2026-11-06-tool-surface-hiding-spike.md`, D1 and D2). It then re-measures both corpora: lh-a0 (36 runs) and the H3 spike-pack (930 runs).

Scripts, logs and per-run JSONL: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/attribution/`.
- `attr-all.ts`: per-run attribution. Output: `before.jsonl` and `after.jsonl`.
- `compare.ts`: join against the audit's hand classes. Output: `compare-final.txt`.
- `verdicts.ts`: verdict split per corpus.
- `home-attr.ts`: the `~/.reactive-agents/traces` corpus.
- `d2-spike.ts`: D2 trigger census.
- `redcut/`: red-on-cut harness.

## Verdict (read first)

1. **The model share drops 3-7 points, and every harness cause the audit named is now visible.**
   - H3 current code: harness 18% → 24%, model 73% → 66%.
   - H3 all: harness 22% → 26%, model 70% → 66%.
   - lh-a0: harness 6% → 12%, model 85% → 82%.
   - `model:had-evidence-wrong-output` falls from 203 to 173 on H3 (79 → 69 on current code) and from 19 to 6 on lh-a0. Most of the lh-a0 change stays model-owned: 12 runs move to `model:evidence-not-gathered`.
2. **Agreement with the audit's hand classification of the 39 runs:**
   - Exact mechanism: 18/39 → **25/39**.
   - Owner: 29/39 → **32/39**. The 4 grader/task runs (G) can never match, so the ceiling is 35.
   - Seven owner disagreements remain, listed below with reasons. For one of them (01M6Q2W4XTCW) I propose changing the hand class.
3. **Every pin is red on cut.** The 11 real-trace pins fail 11/11 against the baseline `packages/trace/src` (main checkout) and pass 11/11 on the fix (`redcut/redcut-base.log`, `redcut/redcut-after.log`).
4. **The top harness reason for the improvement loop on current code is still `harness:tool-call-dropped`**, with 17 runs (was 15). The I3 fix exposed intra-batch drops. Next come `stall-after-work` (9) and the new `plan-fanout-blob` (6).

## Faults fixed

| # | Fault | Fix (all in `packages/trace/src`) | Pin (real trace, trimmed) |
|---|---|---|---|
| I1 | The run-writes target fallback picked a written file whose checks passed | Failed checks that name known files by stem (written or task-listed) keep only the named written files. Checks that name no known file (`contains a data table`) keep every written file. `attribution-facts.ts` `pickTargets` | `lh-cogito-debug-green-offer.jsonl` (01M6RFTETPXB, no longer clamp.ts); `lh-cogito-rw-7-passing-write.jsonl` (01M6RFQE1SPX, pipeline.ts not validator.ts) |
| I2 | had-evidence never asked whether the failing item's evidence was gathered | New `model:evidence-not-gathered`. It fires when a task-listed input (an absolute or `./` path, plus numbered ranges like `notes-1 through notes-6`; conditional `If ...` sentences are skipped) was never read before the divergence turn. The cutoff is the write itself for planned writes. It needs a produced output, so runs that produced nothing keep their cause-derived reason. Decisive when a failed check or target ties to the input. `attribution-rules.ts` | `h3-cogito-todo-heavy-unread-input.jsonl` (01M6Q5DEVYKN) |
| I3 | `droppedCalls` matched by tool name, so one write that ran hid two dropped writes | `nativeCalls()` gives each native call a fate (`ran`, `notice`, `refused`, `dropped`), matched by tool AND path | `h3-qwen-rw-7-batch-drop.jsonl` (01M6PY66QWK3, seq 718) |
| I4 | `presence()` tested the recorded preview and ignored what the projector did | `curatedPresence()`: when the projection for the divergence turn compressed results of that tool, they count as elided. When the compressions cover only some results, they count as unverifiable. (Curator `_tool_result_N` refs cannot be linked to a tool call; see producer changes.) | `lh-cogito-rw-4-compressed.jsonl` (01M6REK7BVNF) |
| I5 | A result the guard replaced was dropped silently, and a write the guard replaced counted as written | `executedOk()`: a repetition-notice result means the call did not run. This holds for writes (no divergence) and reads (not gathered). New `harness:refusal-counted-as-repeat` fires on a first call the guard replaced. It has two forms. Decisive: the call withheld a listed input, or the failed check names the replaced write's value. Probable: other replaced writes; this form is ordered after the model rules | `h3-qwen-todo-heavy-blocked-writes.jsonl` (01M6Q4JE73TF: write of `84` replaced, check expects 84); `h3-qwen-todo-heavy-repeat-guard.jsonl` (01M6Q2W4XTCW) |
| I6 | Tool-gate refusals of evidence reads were not counted as withheld | New `harness:evidence-withheld`: the model asked to read a listed input, and every request was refused or replaced | `h3-qwen-todo-heavy-gate-refused-reads.jsonl` (01M6Q52V413A) |
| live | plan-execute `{{from_step}}` fan-out | New `harness:plan-fanout-blob`: a failing file holds content (40 chars or more) that no native call wrote to it, and the same content was written to another file | `h3-qwen-plan-only-fanout.jsonl` (01M6Q4Z1Z7F6) |
| live | Offer-to-continue accepted as done | New `harness:offer-accepted-as-done`: a model-side end, and the last 400 chars of the output contain `would you like me to <work verb> ...?` (or the let-me-know form). Help offers do not match | same as the I1 pin (01M6RFTETPXB, exit gate accept at seq 885) |
| D1 | `model:tool-protocol` for a `file-write` printed while no tool was offered | New `harness:tool-not-offered`: a `think` turn asked for a tool (native, or a printed JSON call with a kebab/snake-case name) that its `toolSchemaNames` lacked, and the tool never ran. It fires only when that turn offered no domain tool, or the trace shows the tool exists. Probable until the producer emits dropped builtins | `synthetic-write-not-offered.jsonl` (hand-built; the original local-store fixture was not published, owner decision) |
| D2 | `cause=none` on a zero-call success that named a page title for an unfetched URL | `analyzeCause` returns `success-with-warning/tool-claim-without-call`. Conditions: a success with zero real calls (events and ledger), and the task's current turn names a kebab-case tool as `the T tool`, or the output shows T in a code span or fence. Warning only, never a failure. `tool-claim.ts` | `synthetic-tool-claim-without-call.jsonl` (hand-built; same reason) |

Rule file split: the new rules live in `attribution-rules.ts` (325 lines), so `attribution.ts` stays under the 1,000-line gate (774 lines). The rule types (`Ctx`, `Hit`, `Rule`) moved to `attribution-facts.ts`.

Honesty-rule amendments (documented in each file header):
- `attribution.ts` now reads the `run-started` task text to find listed inputs. It also reads the end of the shipped output for an offer to continue. That is an intent check, not a correctness check.
- `cause.ts` "never reads model text or task wording" now has one bounded, warning-only exception: D2.

## Before and after reason tables

### H3 spike-pack, 930 runs (498 failed; current code: 175 failed)

| Reason | all before | all after | current before | current after |
|---|---|---|---|---|
| model:had-evidence-wrong-output | 203 | 173 | 79 | 69 |
| model:evidence-not-gathered | – | 18 | – | 1 |
| model:fabrication-vetoed | 65 | 65 | 29 | 29 |
| model:ignored-guidance | 57 | 54 | 17 | 15 |
| model:tool-protocol | 13 | 13 | – | – |
| model:never-engaged | 7 | 7 | 2 | 2 |
| model:wrong-tool-arg | 6 | 1 | – | – |
| harness:tool-call-dropped | 20 | 33 | 15 | 17 |
| harness:plan-fanout-blob | – | 13 | – | 6 |
| harness:terminal-mislabel | 19 | 16 | – | – |
| harness:tool-call-corrupted | 15 | 12 | – | – |
| harness:false-veto | 12 | 12 | 1 | 1 |
| harness:stall-after-work | 11 | 11 | 9 | 9 |
| harness:evidence-truncated | 10 | 10 | 1 | 1 |
| harness:completeness-blind | 9 | 7 | – | – |
| harness:loop-after-work | 6 | 6 | 3 | 3 |
| harness:subpass-abstained | 4 | 4 | – | – |
| harness:premature-stop | 3 | 3 | 2 | 2 |
| harness:refusal-counted-as-repeat | – | 2 | – | 2 |
| harness:evidence-withheld | – | 1 | – | 1 |
| unattributed | 29 | 28 | 8 | 8 |
| environment:* | 9 | 9 | 9 | 9 |

Notes on the moves:
- `model:wrong-tool-arg` → `evidence-not-gathered` (5 runs): plan-only runs whose planned read had no path, so `inventory.csv` was never read. Both labels are model-owned. The old label was more specific about why.
- `harness:terminal-mislabel`, `tool-call-corrupted`, `ignored-guidance` → `tool-call-dropped` (8 runs): intra-batch drops that I3 now sees. Example: 01M6KHVSA52R emitted 6 file-writes and 1 ran.
- 1 run went from had-evidence to `unattributed` (01M6MW471XCC). Its old target, validator.ts, had passed. The failing files were never written, and the trace cannot prove a side.

### lh-a0, 36 runs (33 failed)

| Reason | before | after |
|---|---|---|
| model:had-evidence-wrong-output | 19 | 6 |
| model:evidence-not-gathered | – | 12 |
| model:ignored-guidance | 5 | 5 |
| model:fabrication-vetoed | 4 | 4 |
| harness:tool-call-dropped | 2 | 2 |
| harness:evidence-truncated | – | 1 |
| harness:offer-accepted-as-done | – | 1 |
| environment:* | 2 | 1 |
| unattributed | 1 | 1 |

`rax-diagnose attribute --all` on the lh-a0 traces before the fix is in `cli-before-lh-a0.txt`, and it matches the table above. The CLI could not produce the after table: in this worktree the CLI resolves `@reactive-agents/trace` to the main checkout (there is no worktree `node_modules`). So the after tables come from `attr-all.ts`, which calls the worktree's `attributeFailure` and gives the same tally. Re-run the CLI after integration.

### Home corpus (`~/.reactive-agents/traces`, 3,038 files): D1 and D2

- `harness:tool-not-offered`: 0 → 23. That is 22 runs that read `harness:tool-call-dropped` (native calls to an unoffered tool, mostly this job's surface-spike probe arms) plus 01M6JEXWPTSQ, which read `model:tool-protocol`.
- `model:tool-protocol`: 6 → 5.
- 01M6FMFJGN71 stays `harness:tool-call-dropped`. `write_file` is not a name the trace shows exists, and the wire offered domain tools.
- `success-with-warning/tool-claim-without-call`: 0 → 4.
  - 01M6JEVEK40A (D2 target) and 01M6QJMXT9XC (printed `<tool_use>` list-directory, no call) are true positives.
  - 1do14lcw4z6lg and 2p131q7h6trjp ("Use the file-write tool", cortex approval flow) are uncertain. Their trace files start at seq 60 with no tool events, so the write may have run under another run id.
  - **False-positive risk:** 0 confirmed in 2,441 zero-call successes. Two traps were removed during the spike:
    - The `with <word>` phrasing ("with domain-specific", grok-4) is not used.
    - Conversation history before `contract-compiled.currentTurn.offset` is skipped. This dropped 01M6JEK7M11M, an earlier turn's `session-control tool`.
  - Residual risk: a task that names a tool that does not exist, and a tool executed outside this trace (approval flows).

## Agreement with the audit's 39 hand classes

Exact mechanism 25/39 (was 18), owner 32/39 (was 29). The 7 owner disagreements:

| Run | Hand | After | Why |
|---|---|---|---|
| 01M6PWRBP4FG, 01M6PXBN78NS, 01M6PZSGVC7M, 01M6QB5C72DT | G | had-evidence | A grader or task-text mismatch cannot be seen from the trace (by design). |
| 01M6RFAD6P6C | H-gate | evidence-not-gathered (decisive) | 4 of 6 modules were never read, and the model never asked for them. The run ended by `loop_resolution` → `harness_synthesis`. The instrument cannot tell "harness ended it early" from "the model skipped them" without the listed-input coverage signal, which the audit deferred to a spike. |
| 01M6Q2W4XTCW | M2 | refusal-counted-as-repeat (decisive) | **I propose reclassifying this run as H-withheld.** The model asked for notes-3..6 three times. Tool-gate refusals blocked the first two batches (11 refusals). The guard then replaced the first-time reads at seq 1076-1100. The audit text itself records this. The model also wrote blind in the same batch, so the run is mixed. |
| 01M6PY66QWK3 | M1 | tool-call-dropped (decisive) | The harness dropped the correct processor.ts write. That flipped one of the two failed checks, which the audit also found. The model's pipeline.ts fix was wrong. Both causes are real. The rule order puts the harness defect first. |

Also notable:
- 01M6Q4JE73TF agrees on the owner, and the mechanism is sharper than the audit's. Out-2..4 failed because the guard replaced writes that carried the correct values (84, 16, 126), not only because the notes-5/6 reads were refused.
- Three runs remain M2 misses, labelled had-evidence because their inputs are not path-listed: 01M6RGJKYFHN and 01M6RG4AATT2 (web research) and 01M6RFP9NW27 (an unlisted comments endpoint).
- Four M1 runs now read `evidence-not-gathered`, with the owner agreeing:
  - 01M6REVGP6DE and 01M6RGR0WXXA (debug-green): the failed checks name 5 modules that were never read.
  - 01M6REWCEQEQ: wrote invalid.txt before reading the invoices.
  - 01M6RGHARXTR.

## Producer changes for the parent (out of my authority, ranked)

1. **Emit a `tool-surface-resolved` reason for builtins dropped by the opt-in**, for example `hidden: builtins opt-in`. Location: `packages/runtime/src/engine/phases/agent-loop/setup/tool-schemas.ts:139-165` (runtime-warden). This makes D1 decisive and lets D2 use a registry instead of task wording.
2. **Put the refused call's target on tool-gate refusals.** Today `guard-fired{guard:"tool-gate"}` carries only `toolName` and `toolCallId`, and `llm-exchange.response.toolCalls` carries no ids. So refusals are matched by count per tool, not per call. Location: `packages/reasoning/src/kernel/capabilities/decide/tool-call-refusals.ts` (kernel-warden).
3. **Make curator decisions linkable**, for example a `toolCallSeq` or `toolCallId` on `curator-decision`. `_tool_result_N` does not follow call order (in 01M6REK7BVNF, `_tool_result_1` is the second call), so I4 works per tool, not per result.
4. Record the raw result length on `tool-call-end`. The recorded result is the act-time preview.

Docs outside my authority: the reason table in `apps/docs/src/content/docs/reference/cli.md` (around line 345) needs the six new attribution reasons and the `tool-claim-without-call` sub-cause.

## Verification

- `bun run repo verify packages/trace`: pass (tests, typecheck, cross-cutting).
- `bun run repo verify packages/diagnose`: pass.
- `bun run repo test packages/trace packages/diagnose`: 0 fail.
- `bun run repo check --all`: 34 pass, 0 fail.
- Logs are in the job dir (`verify-*.log`, `check-all.log`).
- Caveat: diagnose and benchmarks resolve `@reactive-agents/trace` from the main checkout in this worktree, so their suites did not exercise the new code. After integration, re-run `packages/diagnose`, `packages/benchmarks/tests/eval-graded.test.ts` and `packages/benchmarks/tests/h3-verdict.test.ts`.

## Limits

- Listed inputs come from path tokens in the task text. Web, URL and endpoint evidence is not covered. For rw-9, the conditional sentence rule keeps `fallback-prices.json` out.
- The probable form of `refusal-counted-as-repeat` and `evidence-withheld` cannot show that the blocked call would have passed.
- The linking heuristics (stem in a check name, same number in file names) are documented in `attribution-rules.ts`.
- Red-on-cut was run against the whole baseline, not one cut per fault. Each pin fails on the baseline, and each pin exercises one fault's rule.
