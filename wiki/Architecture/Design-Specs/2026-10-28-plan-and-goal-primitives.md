---
type: design-spec
status: approved
created: 2026-10-28
updated: 2026-10-28
tags: [design-spec, planning, goals, long-horizon, judgment, cortex, harness, meta-loop]
---

# Plan and Goal Primitives: adaptive task completion on the meta-loop

Status: approved (revision 2). Revision 1 described a plan stack parallel to the ratified meta-loop. An adversarial alignment review (2026-10-28) showed that it would add a fourth task list and a second event channel beside the ledger, and break the wither ratchet. This revision builds every primitive **on** the meta-loop instead. Sections marked *(my call)* are the author's choices; the owner should confirm or overturn them.

## Intent

The harness is tuned for quick tasks. It nudges the agent to finalize early and ends a run at a hard iteration ceiling (`maxIterations`, defaulting to 10 in many kernel sites). Work that needs many steps, or many sessions, fights those rails. The industry has moved toward long-horizon agents: Claude Code `/goal`, Codex `/goal`, Ralph loops, and Anthropic's initializer plus coding-agent harness. The framework should handle that range without penalising short tasks.

The framework already has the canonical spine for this. The ratified meta-loop (`2026-07-11-harness-north-star-architecture.md`, 09 §3) is:

**RunContract → RunLedger → RunAssessment → Control/Policy → Actuators → Projector.**

- The contract holds frozen requirements and deliverables.
- The ledger records requirement `declared → satisfied | blocked` facts with evidence.
- The assessment computes satisfied, outstanding and blocked requirements, the evidence delta, and stall, every iteration.
- The policy compiler (`HarnessPlan`) turns task classification into posture.
- The projector already recites the outstanding requirements to the model.

What is missing is narrower than revision 1 assumed:

- **Nothing reaches the user.** The model sees what remains, but no UI, TUI or app does.
- **The model's own task list is off the spine.** The `todo` meta-tool keeps its checklist in a process-global scratchpad Ref, outside the ledger. It leaks across runs, needs a manual reset, and is invisible to every projection.
- **Long-horizon pursuit has no driver.** There is no runtime loop that runs a contract across bounded segments, with a budget and a judgment-backed verdict.

This design closes those gaps by extending the meta-loop, never by building beside it.

## Goals

1. **One truth, many projections.** The user-facing checklist is a projection of contract × ledger × assessment. That is the same source the terminal gate judges and the model is shown, so the three cannot drift apart (north-star §2.4 / §6).
2. **The model's task list joins the spine.** `todo` items become ledger facts. They are advisory work items: they show progress, and they never count toward done-ness.
3. **Triage is classification, not a new stage.** "What does this task need" becomes fields on the canonical `TaskClassification` and outputs of the `HarnessPlan` compiler. A quick question never grows a checklist.
4. **Goals are contracts with a budget.** A goal is a `TaskContract` plus a budget, run as bounded segments. Confirmed criteria compile into frozen `RunContract` requirements. The verdict is the terminal gate plus a judgment checker tier. Stall is read from the assessment.
5. **Visible progress, durable by construction.** The ledger rides checkpoints, so the checklist survives crash-resume, strategy switches and passes without any extra state.
6. **Developer control without surface sprawl.** New capability arrives as options on existing withers, contract fields, or policy fields, never as new openers (wither ratchet, north-star §5).
7. **Honest results.** `goalAchieved` stays `true | false | null`, and nothing turns unknown into true.

## Non-goals

- Automations or n8n-style node workflows. That is a later phase and will consume these primitives.
- Exposing model thinking effort or token budgets.
- New features for maintained strategies (plan-execute, reflexion, tree-of-thought, blueprint). They are "maintained, not invested" (north-star §7).
- Strategy merging before 09 Steps 2–3 land (09 §8).
- Cross-process or multi-agent goal sharing.

## Anti-goals

- A fourth task list, or any checklist that can say "done" while the gate disagrees.
- A second event channel beside the ledger. A UI snapshot is acceptable only if it is derived from ledger facts in the projection layer, never published by the kernel.
- New `with*` openers past the ratchet ceiling.
- Mandatory decomposition: a quick question that grows a checklist.
- An unbounded goal.
- The model grading its own work.
- Loosening early-stop guards globally.
- Default-on behaviour change without the lift rule.

## Primitives (each is a meta-loop node extension)

### 1. Ledger: advisory checklist facts *(Contract and Ledger nodes)*

- **Self-describing requirement facts.** `requirement` facts gain the requirement's `description` and `kind` on their `declared` entry, so the ledger alone can render the contract's items.
- **Advisory items.** A new ledger fact, `checklist-item`, records the model's advisory work items: an add with titles, and status changes. `todo` becomes a thin tool over these facts. Its model-facing contract (description, parameters, rendered text) stays byte-identical, and its list is a fold of the run's ledger. That removes the process-global Ref.
- **Durability.** The ledger is run-scoped across passes (`run-ledger-scope.ts`) and rides checkpoints. The checklist is therefore durable and survives a strategy switch with no extra state. On resume, no completed item is redone, because its fact is already in the restored ledger.

### 2. Projector: the checklist view *(Projector node)*

A pure projector, `projectChecklist(facts)`, folds `requirement` and `checklist-item` facts into a `Checklist`. Each row is one of two kinds:

- **Requirement rows.** Their status is gate truth (`declared` / `satisfied` / `blocked`). They are the only rows that relate to done-ness.
- **Advisory rows.** These are model-authored `todo` items, labelled advisory. They never count toward done-ness.

The projector is one function, reused by every surface: the runtime stream projection, the TUI, and any app. It reads facts only.

**Parallel and delegated work uses the existing delegation substrate.** Facts are grouped by their existing `pass` provenance:
- `sub-agent:<name>` facts are merged into the parent ledger by `mergePassLedger`.
- Verification-retry and continuation passes fold into the run that owns them.
- A running child's live facts reach the parent's shared bus and are placed in the tree using the `rootRunId`/`parentRunId` correlation that already exists.
- When a child completes, its merged facts replace its live group, so nothing is counted twice.
- Only the root's requirement rows decide the run's done-ness.
- Parallel children are sibling groups.

No new delegation, progress or cost mechanism is added. Cost and trace views build on the existing budget fold and `rootRunId` trace grouping.

### 3. Triage *(Comprehend and Policy nodes; Phase 2)*

`TaskClassification` gains `needs` (direct | tools | plan | goal) and `verifiability` (checkable | judgeable | open) next to its existing `horizon`. Deterministic rules come first. A judgment `Choice` refines them as a typed classifier signal (canonical-contracts invariant I7). `compileHarnessPlan` turns them into a planning posture, for example whether to offer `todo` or whether to suggest a goal. The behaviour change goes through the lift rule.

### 4. Decompose *(Contract node; Phase 2)*

Judgment proposes contract requirements and deliverables, plus suggested advisory items, from an objective. The caller (user, UI or code) accepts or edits the proposal before the contract is frozen. Once frozen, the model cannot edit requirements (north-star §2.1). Checks use the existing `PostCondition` and `SuccessCriterion` vocabulary; no parallel check type is added.

### 5. Evaluate *(Assessment and terminal-gate nodes; Phase 3)*

The evaluator is the existing terminal gate and its `AcceptanceTier`s (deterministic → checker → self-critique), plus a judgment checker tier that returns achieved | progressing | stalled | blocked with calibrated confidence. Stall reads the assessment's evidence delta and per-requirement stall. Low confidence never declares done. The result maps to `goalAchieved: true | false | null`.

### 6. Goal, Segment, Handoff *(Control node; runtime loop; Phase 3)*

- **Goal.** A `TaskContract` (extended to hold several success criteria) plus a budget: tokens, cost, wall-clock and segment count, with defaults so a goal is never unbounded.
- **Segment.** One ordinary run through the normal kernel and its normal guards, over durable runs, sharing the run ledger.
- **Handoff.** The standing frame renders the contract's outstanding requirements, the ledger handoff, and the advisory list. It is not compaction.
- **Budget control.** The runtime enforces the budget; the model can only propose done. Pause, resume, clear and budget changes belong to the user or the runtime.
- **Stop reasons.** achieved, budget-limited, stalled, blocked/needs-user, paused, cleared.

### 7. Strategies as policies *(Phase 4, after 09 Steps 2–3)*

The maintained strategies hollow into policies of the one loop. This is sequenced by 09, not by this spec.

## Surface

- **Stream.** UIs get the checklist from ledger facts. The runtime projection layer derives a `ChecklistUpdated` snapshot from `LedgerEntryAppended` with `projectChecklist`, at full density (the ContextPressure precedent), gated by the toggle. The kernel publishes nothing new. A resumed run seeds the projection from the restored ledger.
- **Toggle.** One display option, `checklist`, on the existing `.withObservability()` and `AgentConfig.observability`. It controls the stream snapshot and the TUI. It is not a new opener, and it changes nothing the model sees.
- **Model side.** The model's access to `todo` stays `.withMetaTools({ todo })`. Whether one toggle should also offer `todo` is decided by the Task 0 lift-rule ruling, using local-model probe evidence (see the probe report).
- **API.** Goal configuration rides `.withContract()`, extended. Posture rides `HarnessPlan` fields. A programmatic `agent.pursue(contract, budget)` entry point is in Phase 3.
- **Cortex.** A plan card in chat shows requirement rows with gate status and advisory rows labelled as such. Phase 3 adds `/goal`, `/plan` and a goal bar.

## Constraints

- **Warden routing.** Each edit goes through the warden for its domain (AGENTS.md table), with a MissionBrief, logged in the pilot log.
- **Lift rule.** Default-behaviour changes need ablation through ablation-warden (at least 2 tiers, at least 3pp lift, at most 15% token overhead). Goals ship opt-in.
- **Meta-loop law.** One-directional DAG; the ledger is the spine (C1); one terminal outcome (C7); single ledger writer (`check-ledger-writes.sh`).
- **Ratchets.** Wither ceiling (`builder-wither-ratchet.test.ts`), file-size ceilings, string-throw count, and cross-cutting checks.
- **Sequencing.** 09 §8 sets WIP = 1. The owner places this program against 09 Steps 2–6.
- **Standards and honesty.** Effect-TS, no `any`, tagged errors, JSDoc, and tests. No claim that this "improves results" without measurement.

## Decisions made by the owner

- Goal takes an objective and optional completion criteria. Criteria can be edited or changed on request.
- When only an objective is given, the harness shows the inferred criteria for confirmation before starting.
- A live checklist is surfaced for all task completion, not only goals.
- Planning, decomposition, step execution and tracking become lower-level primitives; strategies remain selectable.
- Triage must be fast and cheap, like a classification pipeline.
- Flexible, controllable, composable primitives are preferred over fixed behaviour.
- Judgment is used for goal classification and termination accuracy.
- The checklist is toggleable from config, and that setting drives the UI in the TUI and in applications such as Cortex. Good developer experience is a requirement.
- The checklist is durable and works with durable runs, so completed steps are not repeated.
- One `todo` surface is preferred. Its exposure to the model is decided by local-model probing before the spike, not assumed.
- The plan must align with the ratified architecture: canonical primitives that build on each other, not fractured logic.

## Phasing *(my call)*

1. **Checklist on the spine.**
   - Self-describing requirement facts.
   - `checklist-item` facts, with `todo` moved onto them.
   - The `projectChecklist` projector.
   - The runtime snapshot and the TUI view.
   - The display toggle on `.withObservability`.
   - The Cortex plan card.
   - Durable by construction.
2. **Triage and Decompose,** as classification fields, a `HarnessPlan` posture, and contract proposals.
3. **Goals:** contract plus budget, segments, a judgment checker tier, and Cortex goal UX.
4. **Strategies as policies,** after 09 Steps 2–3.

## Author's calls *(owner to confirm or overturn)*

- **Advisory never counts.** Advisory items never count toward done-ness. Only contract requirements do. (If the owner wants model-ticked items to count, they must become contract requirements via Decompose.)
- **No kernel publisher.** The kernel publishes no checklist event. The snapshot is derived in the runtime projection layer from ledger facts.
- **Toggle home.** The display toggle lives on `.withObservability({ checklist })`; there is no new wither.
- **Criteria freeze.** Confirmed goal criteria become frozen `RunContract` requirements, which requires `TaskContract` to hold several criteria.
- **Stall.** A goal is stalled when the assessment shows no evidence delta and no requirement transition for N consecutive segments. N is the builder's call.
- **Budget timing.** The budget is checked at segment boundaries, and existing in-run limits bound each segment. No new mid-segment kill path is added.
- **No-judge fallback.** With no judge configured, use the judgment package's LLM-emulation backend. When no model call is wanted, use deterministic tiers only and report `goalAchieved: null` when undecided.

## Left to the builder

- Exact type and fact field names, event payloads, and the shape of the projector input.
- How a resumed run seeds projections from the restored ledger.
- Default budgets and stall N.
- Judgment prompts, backends and calibration.
- Test and ablation design for phases 2 and 3.

## Risks

- **Advisory confusion.** Users may read advisory ticks as done-ness. Mitigation: distinct labelling, and requirement rows drive the done state.
- **Requirement noise.** Some compiled contracts carry few or generic requirements, so the checklist may look thin. Mitigation: Phase 2 Decompose. In Phase 1 the advisory list fills the gap where `todo` is on.
- **Evaluator errors.** False positives and negatives. Mitigation: deterministic tiers first, calibrated confidence, and `null` as a valid outcome.

## References

Anthropic, *Effective harnesses for long-running agents*; Claude Code `/goal` docs; OpenAI Codex `/goal` cookbook; Ralph loop write-ups. Third-party summaries were used for details; verify against official docs before citing specifics.

Related: [[09-UNIFIED-PROGRAM]], [[2026-07-11-harness-north-star-architecture]], [[2026-06-02-canonical-contracts-and-invariants]].

Alignment review: recorded in the plan's review record.
