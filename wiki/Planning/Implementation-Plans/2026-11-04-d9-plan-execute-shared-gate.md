---
type: plan
status: active
created: 2026-11-04
tags: [harness, convergence, plan-8, plan-execute, terminal, contract]
---

# D9: plan-execute's terminal goes through the shared delivery gate

Plan 8 (`2026-11-02-harness-convergence.md`) section D item 9, the first substrate-convergence step. Chosen option: C1 option B in the tolerance-lane audit (verdict reaches the outcome; no disclaimer regex in the runtime).

## Problem

plan-execute compiles a contract only to word its reflect prompt. Its finish never checks the files the task names, and `finalizeStrategyResult` gets no contract, so `outcome.verdict`, `deliverable` and `verifierVerdict` are null. Consequences measured on H3 (2026-11-04 baseline): `h3-plan-only` fails with `harness:completeness-blind` (4 runs); a refused `totals.json` write is never repaired; the runtime tolerance lane cannot tell an honest partial from a missed deliverable.

## Design (shared primitives, strategy policy on top)

Shared (kernel, strategy-agnostic):

- **A. `openStrategyContract`** (`kernel/contract/strategy-contract.ts`): compile the current-turn contract once at strategy start with the same inputs the reactive runner uses (required tools, writing tools, posture, task contract) and emit `contract-compiled`. Does not seed ledger `requirement` entries yet (that would make `answerSatisfied` false on honest plain partials).
- **B. `judgeStrategyDelivery`** (`kernel/capabilities/verify/strategy-delivery.ts`): pure; `verifyDelivery(deliveryConditions(...))` over steps, ledger and output; returns unmet conditions and a `DeliverableDecision`. `pre-synthesis` phase skips `OutputContains`. Registered with `check-success-authority.sh`.
- **C. `proposeStrategyExit`** (`kernel/loop/strategy-exit-gate.ts`): reuses `disposeExit` as the law (deny once = one targeted repair; then handoff = labelled partial; no material = honest failure). Emits guard `strategy_delivery_gate` (`block` on repair, `terminate` on handoff). Absorbs `evaluateGroundedSatisfaction` (required-tool grounding).
- **D. Mint arm in `finalizeStrategyResult`**: with no `kernelMeta` and a `runContract`, judge with B (or take the strategy's decision) so `deriveTerminalOutcome` sets a non-null verdict. Pause, abstained and failed results are fenced. No `runContract` = byte-identical.

plan-execute policy (strategies/): consult C at reflect SATISFIED; deny-once feeds missing-deliverable guidance into the existing `refinePlan`; handoff appends a harness-written `Unfinished:` block after `enforceQualityGate`; pass `runContract` to every finalize call. Step kernels keep `deliveryScope: "step"`; only the plan as a whole is judged.

Runtime: `execute-success-invariants.ts:160-170` already vetoes `partial` + `verdict.accepted === false`; plain answers get `accepted: true`, so the tolerance lane is unchanged for them.

## Phases

| Phase | What | Owner | Rule |
|---|---|---|---|
| P1 | Composite-step evidence (sub-kernel `file-write` etc.) reaches the plan run ledger | parent (`step-executor.ts`) | correctness, no-regression |
| P2 | A + B + D; plan-execute and single-analysis pass `runContract`; writing-tools helper extracted from `runner.ts` (ceiling lowered) | kernel-warden + parent | correctness, no-regression |
| P3 | C primitive + pure disposition pins; `unfinishedBlock` shared with handoff synthesis | kernel-warden | pins |
| P4 | plan-execute adopts recovery (repair via `refinePlan`, handoff `Unfinished:`); `plan-execute.ts` ceiling lowered | parent | lift rule (new recovery) |
| P5 | Runtime consumer pin (refused partial is not success; accepted partial tolerated) | runtime-warden, test-only | pin |
| P6 | Follow-on adopters: blueprint, code-action, ToT no-leaf (verdict only); reflexion spine replaced by B + C | separate items | per item |

Every phase pin must go red when its fix is cut.

### P7. The plan is the checklist (state the harness already tracks, surfaced live)

Added 2026-11-04 at the user's direction: reliability from determinism, not from the agent remembering to call a tool.

Today: the live checklist pipeline already exists (ledger facts, then `LedgerEntryAppended`, then `makeChecklistTracker` in core, then `ChecklistUpdated` on the stream, then ui-core `run-machine`, then Cortex). It shows requirement rows (gate truth) and advisory rows from the `todo` tool, with deterministic inferred completion (`inferChecklistProgress`). Two gaps for plan-execute: its plan steps never become checklist facts, and its ledger sink (`executeToolAndObserve` `ledgerSink` path, `recordToolDispatch`) grows the result ledger without announcing, so live consumers see none of a plan-execute run's tool facts either.

- One announced strategy ledger sink: strategy-held ledger growth publishes `LedgerEntryAppended` as it happens (reflexion and code-action announce only at the end today). Sub-kernel merges (`recordSubKernelSteps`) stay unannounced because the sub-kernel already published them.
- A ledger-home emitter turns plan transitions into `checklist-item` facts: plan created/patched/augmented = `add` (ids = plan step ids, titles = step titles); wave dispatch = `in_progress`; step success = `completed`. Harness-written rows carry a distinct origin (proposed `source: "plan"`) so consumers can tell plan state from model marks and evidence inference. Rows stay advisory; requirements remain the only gate truth.
- Plan-declared deliverables (`plan-declared.ts`) read the same facts, so a plan-execute plan feeds deliverables with no `todo` call (that mechanism is inert by default today because `todo` is opt-in).
- Open choice: failed and skipped plan steps (`ChecklistItemStatus` has no failed state). Default: leave the row pending and let the D9 handoff `Unfinished:` block name it; extend the status set only if Cortex needs it.
- Pins: a scripted plan-execute run yields a `ChecklistUpdated` sequence with one row per plan step moving pending, in_progress, completed; no `todo` call in the run.

## Measurement

Zero-token pins and `scripts/check-*.sh` first. Then H3 qwen3:4b + cogito:8b, k=5: `h3-plan-only` (lift) and `rw-3` (plan-execute no-regression); full H3 at close. Verdict: `h3/verdict.ts --reason harness:completeness-blind --mechanism strategy_delivery_gate`. Expected: completeness-blind 4 to 0 on `h3-plan-only`; `requirement:artifact-produced@task-explicit` appears at plan level; the gate guard fires on runs that reached SATISFIED with files missing. `firedAfter = 0` means INERT.

## Risks

- Plain answers must still ship (no conditions = accept; pinned in P2 and P4).
- False refusals from evidence gaps: P1 closes composite writes; judging uses `verifyDelivery` (steps + disk), never the ledger-only `conditionMetByLedger`.
- Pinned files: `plan-execute.ts` 987/987 and `runner.ts` 944/944 both shrink with ceilings lowered in the same commit; `arbitrator.ts` untouched (its silent post-condition steer is a follow-up).

## Remaining per-strategy logic (later)

`PLAN_EXECUTE_SATISFIED` naming and `plan-execute/terminal-outcome.ts` status derivation (fold into the mint); `contractCoverageEnvelope` is kernel-meta-only until requirement-ledger seeding is safe.
