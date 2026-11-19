---
type: harness-report
status: design-note
created: 2026-11-18
tags: [zoo, shadow-fire, counterfactual, trace-fields, kernel-warden-brief]
---

# Shadow-fire counterfactual: trace fields needed (brief for kernel-warden)

Design only. No reasoning edits were made. Context: [README.md](README.md) section C. Interleaved live arms are not paired (Ollama sampling is unseeded). A shadow-fire record on the OFF arm gives a true paired counterfactual: the mechanism's trigger is evaluated on every turn of a run that did not apply it, and the inputs are written to the trace.

## Principle

Each lever's trigger is already a pure function of run state (`decideLeanFinalTurn`, act-or-answer eligibility, `declineSettlesOutstanding`). Evaluate it on every turn regardless of the lever flag and emit what it would have decided plus the inputs it read. Emit it as a `guard-fired`-shaped event with outcome `would-fire` / `would-pass` (or a dedicated `shadow-decision` kind). It must not change any request, so an OFF arm's request log stays byte-identical (the zoo `trace` equality check can pin this).

## Fields per record (one per turn per lever)

Common: `lever`, `iteration`, `wouldFire` (bool), `reason` (the decision's existing reason string), `flagOn` (whether the lever was live this run).

leanFinalTurn:
- `inputsExtracted` (count) and `inputsUnread` (names). Failing live runs all had `inputsExtracted: 0` on a task with a tool-coverage requirement.
- `proseInputsWanted`, `proseInputsUnread`.
- `contractSettled`, `toolsShipped` (names on the wire this turn).
- `extractorEmpty` (bool): true when the task has a tool-coverage requirement and zero inputs were extracted. Also emit it as a `warn` signal (fail-open sentinel, README C4).

actOrAnswer:
- `failedCalls` (per outstanding tool), `minFailedCalls` (the threshold in force), `declineTextSeen` (bool), `settledBy` (`none | decline-after-failures | contract`), `errorClass` of the last failure (`permanent | transient | unknown`).
- `priorTurnHadToolCalls`, `droppedCallIds` (the `pending_batch:dropped` case that hides a decline text from `latestTextAfterEvidence`).

Tool-less-turn outcome (for any lever that removes tools, and for natural tool-less turns in the OFF arm):
- `terminatedOnReply` (bool: the run ended on this reply), `replyChars`, `namesUnreadInput` (bool, deterministic), `unmetNeedPhrase` (bool).
- This is the outcome the lean record lacks today.

## What each measurement answers

1. Trigger census with zero live arm: how often `wouldFire` is true across the existing OFF traces, and with what inputs.
2. Paired counterfactual: for OFF runs where `wouldFire` was true at iteration i, did the run later make a tool call that the lever would have removed (lean) or skip a call the lever would have forced (act-or-answer)? That is the lever's cost or benefit on the same sample, not a neighbouring one.
3. Zero-token regrade: with the fields in the trace, a zoo shape's fidelity can be checked against live records (`inputsExtracted` distribution, `declineAfter` distribution per model).

## Acceptance

- OFF-arm request log unchanged with the shadow records enabled (pin with a seam test).
- The 15 rw-6 traces and the gemma ab-trap-5 / h3-exact-value traces in this directory can be replayed through the evaluator to populate the fields after the fact (replay path), so no new live cell is needed to validate the schema.
- `rax-diagnose` reads `would-fire` counts without a schema change (owner: harness-warden, packages/trace/diagnose; the producer-side schema stays with the kernel-warden).
