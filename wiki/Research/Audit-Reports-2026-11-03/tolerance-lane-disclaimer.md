---
type: audit-report
status: proposal
created: 2026-11-03
tags: [audit, tolerance-lane, partial-substantive-output, plan-execute, honest-completion]
---

# Should the partial-substantive tolerance lane exclude outputs that disclaim the task? (C1)

Proposal only. No code changed. Source: [[2026-11-03-nonreactive-signal-reconfirm]] (C1, C4).

## The lane

`packages/runtime/src/engine/execute-success-invariants.ts:~84-102` (runtime-owned):
kernel/strategy `status === "partial"` plus any non-empty output ships `success:true`, and stamps
`partialToleratedBy = "partial-substantive-output"`. `status-authority.ts` (`deriveFinalStatus`) then
discloses it as `outcome.tolerated:true / toleratedBy`, so run-completed `success` vs
`outcome.success:false` is explained, not hidden. The lane keys on output PRESENCE only.

## Evidence (live cells, llama3.2:3b, plan-execute-reflect)

Both under `wiki/Research/Harness-Reports/2026-11-03-nonreactive-signal-reconfirm-traces/`:

- `s-plan-execute-reflect__llama3_2_3b__file__r0/trace/*.jsonl`: run-completed `status:success`,
  output "The file 'hi.txt' was written ... but it was not found ... The file does not exist."
  outcome: kernel status `partial`, `authority:model-final`, `deliverable:null`, `verifierVerdict:null`,
  `tolerated:true`.
- `s-plan-execute-reflect__llama3_2_3b__file__r1/trace/*.jsonl`: run-completed `status:success`,
  output "I was unable to write the text ... The file 'hi.txt' does not exist, and I was unable to create it."
  Same outcome shape.

The runtime verifier's "10 checks passed" is about output FORM (non-empty, not harness text, etc.), not
task truth; it is not evidence the file task succeeded. Contrast: plan-execute plain r0 (correct
answer 51/Paris) is the same lane and is a legitimate tolerated success. The lane cannot tell the two
apart because plan-execute mints with no kernel meta: `deliverable`, `verifierVerdict`, `verdict` are all null.

## Why the existing give-up gate does not catch it

`finalizeStrategyResult` already has a disclaimer arm (`isGiveUpAnswer`, `CAPABILITY_GIVEUP_PATTERNS` in
`kernel/capabilities/sense/give-up-answer.ts`), but it fires only when `!hasGroundedEvidence(steps)`.
plan-execute attempted tool calls (file-read ENOENT), so some "evidence" exists, and the patterns target
"cannot be completed / no tool exists" phrasing, not "does not exist / was unable to write".

## Options

A. Exclude disclaiming outputs from the lane (regex on the output in the runtime lane).
   For: tiny, closes the 2 observed cells. Against: a third phrase list (brittle, English-only; already
   one in give-up-answer.ts and one in looksSubstantive); false-positive risk on legitimate partials
   that caveat ("could not verify X, but ..."), which would flip real partial work to failure; lives in
   runtime, so the kernel-side termination logic is bypassed (AGENTS.md pitfall 12 wants shared substrate).

B. Require deliverable evidence for the lane. Tolerate `partial` only when the outcome carries a
   non-refused verdict (`verdict?.accepted !== false`, and for a tool task a satisfied
   deterministic criterion), else keep failure. Real fix for the cause: plan-execute's final
   synthesis never crosses the terminal verify gate. Implement by routing plan-execute's finalize through
   the shared terminal verify gate (substrate, strategy-agnostic), so `verdict` becomes non-null; the lane
   then reads a real signal. For: no phrase lists, same law as reactive. Against: bigger change; touches
   plan-execute + runtime lane; needs a lift/regression run (plain plan-execute answers must still ship).

C. Leave as disclosed. For: marker already makes the lane machine-visible (`tolerated`,
   `toleratedBy`, `statusReason`), nothing is hidden. Against: `success:true` on a self-declared failure
   still counts as a pass in gate/bench lanes that read run-completed.status.

## Recommendation

Adopt B as the target, C meanwhile; reject A.

1. Do not add a disclaimer regex to the lane (A): it would be the third heuristic list and trades one
   dishonesty (success over "unable to write") for another (failing honest partial work).
2. Route plan-execute's terminal through the shared verify gate so `outcome.verdict`/`deliverable` exist,
   then let the lane require `verdict` absent-or-accepted. Until then the lane stays as disclosed and
   bench/gate consumers should read `outcome.tolerated` and treat tolerated cells as "unverified success".
3. Cheap interim, kernel-side, no runtime edit: in `finalizeStrategyResult`, relax the give-up arm's
   `!hasGroundedEvidence` fence to "no SUCCESSFUL tool evidence" for strategies with no kernel meta
   (grounded = a tool call that succeeded, not merely attempted). Not done here; needs its own pin and
   a check that reflexion/blueprint do not regress.

Dispatch: kernel-warden (finalize / plan-execute gate routing) + runtime-warden (lane condition).
Needs ablation-warden verdict before changing a default (outcome flips success for the plan-execute
file/plain shapes).

## C4 cross-reference

ToT plain failed in the live cell for a different reason than plan-execute plain is tolerated: ToT's
Phase-2 is a react kernel, the model never authored a final answer (tool loop -> stall ->
`harness_deliverable`), and the terminal gate refused it (`output-is-model-authored`). That veto is honest
and shared with reactive. plan-execute plain passes only because it carries no kernel verdict at all, the
same gap as above (option B closes the inconsistency from the other side). A scripted ToT run where the
model does author the answer ships completed with `outstanding:[]` on all four ToT paths
(pin: `packages/reasoning/tests/strategies/tot-plain-answer-not-vetoed.test.ts`).
