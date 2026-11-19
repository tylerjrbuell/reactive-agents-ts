---
type: harness-report
status: complete
created: 2026-11-19
tags: [diagnose, trace, reflexion, cortex, gemini, checklist, scratchpad, terminal-mislabel, v0.19.0]
---

# Cortex reflexion traces: three findings (2026-11-19)

Two Cortex runs on gemini-3.5-flash with reflexion, recorded after the 11:03 restart. The task was a web-analytics report over MCP tools.

- `01M7T8XTQEARASBWPNVYEEZJZ0` (XT): status failure.
- `01M7T8TYQ8ZRZX1445590XMESP` (TY): status success.

Findings 1 and 3 were faults in the instrument (`packages/trace`), and they are now fixed. Finding 2 is a real defect in the harness. It is owned by kernel-warden and is not fixed yet.

| Trace | `rax-diagnose cause` before | after |
|---|---|---|
| XT | `tool-protocol` (decisive), evidence `guard-fired#1336 unresolved tool call: checklist-unresolved` | `budget-cap/cap-cutoff` (decisive), evidence `terminal_decision#1331 iteration 1/2 capped` |
| TY | `terminal-mislabel` (decisive), evidence `terminal_decision.status=failed but run-completed.status=success` | `none` (probable) |

## Finding 1: `checklist-unresolved` was misread as an unresolved tool call (instrument, fixed)

**Root cause.** `ruleToolProtocol` (`packages/trace/src/cause.ts`) matched any guard whose name contained the word `unresolved`. Commit 88c9957b7 added the advisory guard `checklist-unresolved` (outcome `warn`; `strategies/substrate/checklist-terminal.ts`). On any failed run with open todo rows, that guard alone produced `cause=tool-protocol` and blamed the model's tool calling. In the 4,152 local traces, `checklist-unresolved` is the only guard name that contains "unresolved". The real unresolved-call signal is `terminatedBy=tool_call_unresolved`.

**Second fault, found by the pin test.** The `tool_call_unresolved` fallback cited `f.guards.at(-1)`. `checklist-unresolved` is emitted after the terminal decision, so even a real unresolved-call run would have cited the checklist row as its evidence.

**Fix.**
- `packages/trace/src/terminal-predicates.ts` holds `UNRESOLVED_TOOL_CALL_GUARD`, which matches only `tool_call_unresolved*` and `unresolved_tool_call*` guard names.
- The fallback now cites `f.terminalDecision`.
- Pinned by `packages/trace/tests/cause-checklist-and-accepted-pass.test.ts`. The fixture is `fixtures/cortex-reflexion-checklist-unresolved.jsonl`: the terminal events of XT, with the answer text redacted.

**XT's real cause.** Reflexion ran 4 passes: generate with 10 iterations, then improve passes with 3, 2 and 2. Every pass ended at its cap while still gathering. The last pass was capped at iteration 1 of 2 with `evidenceDelta` 4. The critique never accepted an answer, so the runtime vetoed the run with `outstanding-criteria: answer`. Each improve pass gets `run.iterationShare(...)`, which is 2 or 3 iterations, and the model spent them on new metric calls (device, browser, country) instead of writing the answer. That is a budget-split question for reflexion, not a model tool-protocol fault.

## Finding 2: improve passes lose stored tool results (harness defect, owner kernel-warden, not fixed)

**What fires.** `tool-result-pairing warn "tool result projected from its message: stored ref missing from the scratchpad"`, `recoveredRefs: ["_tool_result_1"]`. It fires twice in XT:
- seq 1231: first think of improve pass 2 (pass 3 overall);
- seq 1292: first think of improve pass 3 (pass 4).

Correction to the brief: TY has 0 pairing events. TY ran one generate pass and then the critique, so no thread was carried into a later pass.

**Which ref, which pass.** In pass 2 (improve 1), `umami/get_website_metrics type=path` (seq 1184) overflowed and was stored as `_tool_result_1` in the run-scoped scratchpad. Kernel snapshot seq 1207 shows `scratchpadKeys:["_tool_result_1"]`. Reflexion then starts pass 3 with `initialMessages: s.runningMessages` (`strategies/reflexion.ts:529`). That thread carries the tool_result message with `storedKey: "_tool_result_1"`. The new kernel state, however, starts with `scratchpad: new Map()` (`kernel/state/kernel-state.ts:1151`). Snapshot seq 1229 shows `scratchpadKeys: []`.

`assembly/from-kernel-state.ts:197-206` finds that the key is missing. It stores the message's own content (the preview that act built) under that ref, and marks the ref recovered and not recallable.

The run-scoped store (`currentScratchpadStore`) still held the full value. After pass 3's first act round, `syncRoundScratchpad` merged the key back: snapshot seq 1253 again shows `_tool_result_1`. So nothing was lost from the system. It was lost only from the projection, for the first think of each carried pass.

**What the model lost** (structure only, values redacted):
- Pass 2, exchange seq 1198: the path result rendered as 20 `- <path> (value=N)` rows, materialized from the stored value.
- Passes 3 and 4, exchanges seq 1237 and 1297: the same result rendered as an 802-char head of the raw JSON preview. That is the envelope plus 5 complete `data` rows, cut mid-row 6, followed by `[content truncated ... result_ref="_tool_result_1" ... Do not retype it.]`. No recall hint was shown, because the ref is marked not recallable.
- 15 of the 20 top-page rows were gone from the model's view at the start of both later passes. The model did not re-fetch them; its later calls asked for other metric types. Any page ranking in those passes' answers had to come from 5 rows.

**Fix location (kernel-warden).** Fix it at the boundary where a pass is seeded with a carried thread: `packages/reasoning/src/kernel/loop/runner.ts:296-300`, where `initialMessages` seeds a fresh base state. When the seeded messages carry a `storedKey`, seed `state.scratchpad` from the run-scoped `currentScratchpadStore` Ref, either for those keys or for the whole Map. Then `from-kernel-state` finds the stored value and the recovery branch stays a true-bug signal.

This one boundary covers every strategy that carries a thread into a new pass: reflexion improve, and plan-execute or continuation passes that use `initialMessages`. A per-strategy patch in reflexion would not. Pin it with a two-pass scripted test that asserts no `tool-result-pairing` event and full materialization of the carried ref in pass 2's first projection.

Note: `nextToolResultKey` mints from the run store (`tool-execution.ts:560`), so keys do not collide across passes. Only the pass-start view is stale.

## Finding 3: TY's "terminal-mislabel" was the instrument (fixed); a kernel record gap remains

**Events.**
- seq 541 `terminal_decision`: `status=failed`, `intent=fail`, `authority=strategy-exhausted`, `terminatedBy=max_iterations`, capped at 10/10. This is the generate pass's kernel terminal.
- seq 546: an llm-exchange with purpose `synthesize`, the report built from the gathered results.
- seq 552: an llm-exchange with purpose `verify`, the critique, which returned `SATISFIED`.
- seq 557: ledger `verdict gate=terminal verified=true` ("reflexion: the strategy's own check accepted the answer"), plus `requirement answer satisfied` (eeedb8f50 `answer-acceptance.ts`).
- seq 572 `run-completed`: `status=success`, `outcome.status=partial`, `answerSatisfied=true`, `tolerated=true`, `toleratedBy=partial-substantive-output`, `outcome.authority=strategy-exhausted`.

**Verdict.** This is the expected answer-accepted path, not a mislabel. The failed decision belongs to the pass. The strategy answered past it, which the ledger records, and the runtime explicitly tolerated the `partial`. `answer-acceptance.ts` documents that a budget-capped pass keeps the run at `partial`. `ruleMislabel` read the last `terminal_decision` as the run's own terminal.

**Fix (instrument).** `acceptedAfterFailedPass` in `packages/trace/src/terminal-predicates.ts` suppresses only the `terminal_decision=failed vs success` clause, and only when both of these hold:
1. `outcome.tolerated === true`;
2. a ledger `verdict gate=terminal verified=true` comes after the last `terminal_decision`.

The pin tests show the clause still fires without the ledger acceptance, and also without the tolerance stamp.

**Corpus impact.** Of 4,152 local traces, 7 match the accepted-and-tolerated shape. 2 flip from `terminal-mislabel` to `none`: TY and `01M7T4XDDRM2VGPW1GCHWG7YR6`, whose pass ended at `dispatcher-early-stop` before reflexion accepted the answer. 2 stay `terminal-mislabel` (`01M7490H6AW2…`, `01M7SZBVYHHF…`): they predate eeedb8f50 and their ledger verdict comes before the terminal, so the exemption correctly does not apply. 3 were already `none`. Of the 2 traces with `checklist-unresolved`, XT flipped and the other was already `none`.

**Remaining kernel record gap (report to kernel-warden, low priority).** When a strategy accepts an answer after a pass terminal, it emits no `terminal_decision` of its own. As a result:
- the trace's last `terminal_decision` says `fail`;
- `outcome.authority` stays `strategy-exhausted`, even though `answerSatisfied=true`.

The instrument now reconstructs the acceptance from the ledger. A single strategy-level terminal record would make the trace self-describing. The fix belongs in the shared terminal path, `strategies/substrate/strategy-run.ts`, around the `ledgerWithAcceptedAnswer` call (AGENTS.md pitfall 12). Example fields: `authority: strategy-accepted:<strategy>`, `status: partial`, `intent: deliver`. A kernel-warden is editing `strategy-run.ts` now; sequence this after that work.

## Side observations (not fixed, no action taken)

- **TY attribution.** `rax-diagnose attribute` says `model:fabrication-vetoed` (decisive), from runtime verifier seq 571: `output-not-fabricated-listed-entities`, with examples "Unique Visitors" and "Total Visits". These are report headings for metrics that the tool evidence names as `visitors` and `visits`, so the check is likely a false positive. That check has 3 earlier false positives on record (cause.ts `ruleNeverEngaged` comment). Attribution counts `outcome.success=false` as a failure even when `tolerated=true`. Also, `run-completed.outcome.verifierVerdict` is `null` although the runtime verifier recorded `verified=false`. Candidate for the next attribution cycle; not changed here (one fix per cycle).

## Files

- `packages/trace/src/cause.ts`: tool-protocol guard match and fallback; mislabel exemption call.
- `packages/trace/src/terminal-predicates.ts` (new): `UNRESOLVED_TOOL_CALL_GUARD`, `acceptedAfterFailedPass`.
- `packages/trace/tests/cause-checklist-and-accepted-pass.test.ts` (new, 5 tests).
- `packages/trace/tests/fixtures/cortex-reflexion-checklist-unresolved.jsonl` and `cortex-reflexion-accepted-after-capped-pass.jsonl` (new; terminal events only, answer text redacted).
