---
type: research
status: complete
created: 2026-11-14
tags: [harness, termination, attribution, audit, zero-token, asymmetric-authority]
---

# Terminal-decision basis audit (zero-token, recorded traces)

Question: does a heuristic-derived requirement or detector hold veto/terminate power while positive claims are accepted without ledger receipts ("asymmetric authority"), and is that the cause of the recurring wrong-outcome class?

**Verdict: MIXED.** The hypothesis is strongly supported for the VETO side (9 of 12 wrong vetoes), weakly supported for the ACCEPT side, and does NOT explain the bulk of wrong outcomes (66% are model-final accepts where every declared/evidence gate passed and the answer was still wrong or partial). The principle is worth adopting as a narrow rule, not as the architectural cause.

Scripts and the 121-row mismatch list: `2026-11-14-terminal-decision-basis-audit/` (`extract.ts`, `an*.ts`, `mismatches.csv`).

## Method and caveats

- Corpus: local-model campaign P2a + P3a, sha `2269ce57e`, 345 cells (9 models, 17 tasks, k up to 3). 24 cells have no `run-completed` (infra aborts, excluded) so **n = 321 terminal outcomes**. Joined `run-completed.outcome` (authority, outstanding, provenance), `contract-compiled` (requirement `provenance.source`), `guard-fired`, `tool-call-end`, `verifier-verdict` and the in-trace `eval-graded` (hidden grader). Supplementary: `~/ablation-traces/{base,head,fix,fix2full,a-only}` (older code, arms re-run the same cells, so NOT independent).
- Ground truth: `solved` = grader accuracy 1.0. Ab-trap tasks count an honest failure/abstention as correct. Grader is graded (partial credit) and sometimes blind (lh-1 hidden test checks files only).
- Basis class is MY classification from code reading plus requirement provenance, not a trace field. D = declared (builder/config/contract: `requiredTools`, caps). E = evidence (ledger/receipt/structural). H = heuristic (prose regex, task-text semantic inference, stall/entropy/loop detectors, default floors). Narration vs floor classification is a judgment call.
- Noise: outcomes cluster by model x task (3 repeats, 17 tasks). Bernoulli per cell; treat gaps under ~10pp as noise. Campaign predates HEAD fixes `d1eb475e9` (SideEffectLanded clause), `0318f3dde`, `2bbeb2d33` (enumeration abstain), `e7c812dce` (deliverables-are-the-answer). So several wrong outcomes below are already patched at HEAD.
- No live model calls made. Not in the corpus: no trace of the "email sent" empty-surface case (analysed from code only).

## 1. Census of decision sites (file:line, basis)

Trigger-vs-gate note: guards only PROPOSE an exit (`exit-gate.ts:6-62`); the gate disposes from `outstandingItems`. So the basis of a stop = guard trigger basis + basis of the outstanding items.

### Can veto success / hold the run to a requirement
| # | Site | Trigger | Basis |
|---|---|---|---|
| V1 | `exit-gate.ts:311` missingRequiredToolsForInput | required tool never called | D |
| V2 | `exit-gate.ts:314-321` deliveryConditions + `verify/delivery-authority.ts` | declared/derived artifact not produced (`isArtifactProduced` `post-conditions.ts:382`, ledger `artifact` entry, tool-call linkage) | D/E for the check; H for derivation of the path from task text (`derive-conditions.ts:684`, literal path regex) |
| V3 | `exit-gate.ts:324` unlandedActionRequirements -> `satisfiability.ts:117`; `derive-conditions.ts:53-70,695` | MUTATION_VERB x EXTERNAL_RESOURCE_NOUN clause in task prose, then "latest non-retrieval tool result succeeded" (`post-conditions.ts:337`) | **H** (derivation) over E (check) |
| V4 | `exit-gate.ts:329-335` + `claimed-actions.ts:142` unbackedClaimedActions | answer prose matches ACTIVE/PASSIVE_CLAIM regex + tool-name token match, no successful call | **H** detect x E check; fail-open when surface empty (`claimed-actions.ts:147-148`) |
| V5 | `exit-gate.ts:268-291` answerGap (`NEXT_STEP` via `detectContinuationIntent` regex line 275; narration via `assistantTurn.callIds` 286; stale text 287) | answer shape | H (continuation regex), E (narration, stale-after-evidence) |
| V6 | `exit-gate.ts:719-727` + `runner-helpers/tool-health.ts` unavailableRequiredTools | required tool failed GIVE_UP_STREAK times | E |
| V7 | contract floor `answer` (`question-answered | floor`, 344/344 contracts) feeding V5 | default-assumed for every task, incl. file-output tasks | **H (default)** |
| V8 | `verify/verifier.ts:329,344,424` action-success, non-empty, agent-took-action | final-answer success bit, empty text, no non-meta tool | E |
| V9 | `verifier.ts:582,639,659,683,699,717` continuation-intent, fabricated-measurement, test-claim, listed-entities (warn-only), unbacked-action-claim, evidence-grounded | prose regex/number extraction vs observations; reject only when `fabMode==="block"` (642,661,701,715) | **H** |
| V10 | `verifier.ts:371,509,556,607` model-authored, harness-parrot, shallow-giveup, scaffold-leak | text shape | H/E |
| V11 | `loop/runner-terminal-verify-gate.ts:53`, `runner-output-quality-gate.ts:44` | applies V8-V10 severities (reject/escalate -> failed) | inherits V8-V10 |
| V12 | `decide/arbitration-veto.ts:40` shouldVetoSuccess (controller-history x tool failures), applied `arbitrator.ts:250,307` | stall/inject thresholds AND failed tools | H x E |
| V13 | `decide/terminal-gate.ts:268` (exemption, grounding, coverage, evidence, checker); `grounded-terminal-gate.ts:42`; `arbitrator.ts:136` applyPostConditionGate | zero successful substantive calls with requiredTools; coverage from ledger | D/E |
| V14 | `terminate.ts:100-160` post-condition gate at `terminate()` | unmet delivery conditions | D/E (derivation H as V2) |
| V15 | runtime `engine/execute-success-invariants.ts:142` abstainedNotSuccess | terminatedBy abstained | E |
| V16 | same `:162` outstandingContractNotSuccess | `rr.metadata.outstandingCriteria` non-empty (inherits V1-V7) | inherits |
| V17 | same `:230-240` terminalOutcomeNotSuccess | `reconciled.success===false`, partial refused unless `answerSatisfied===false` and not `deliverablesAreTheAnswer` (206) | `answerSatisfied` H; deliverables E |
| V18 | same `:250-259` requiredToolUnmetNotSuccess | declared requiredTools, no successful non-meta call | D/E |
| V19 | same `:298-336` emptyOutput / unproducedDeliverable | declared deliverables (`builder/helpers.ts:179` deriveReceiptDeliverables: task phrasing + contract) vs ledger | D/E (+H derivation) |
| V20 | `runtime/engine/phases/agent-loop/verification-quality-gate.ts:121`, `finalize/verification-outcome.ts:30` | runtime verifier verificationBlocked | E |
| V21 | `runtime/engine/finalize/status-authority.ts:28-37` | folds V15-V20 markers into the one authority string | n/a (record) |

### Can force or propose termination
| # | Site | Trigger | Basis |
|---|---|---|---|
| T1 | `runner-helpers/stall-deliverable.ts:267,420` (stall_deliverable) | no new non-meta tool observation for `stallThreshold` iterations (`horizon-profile.ts:78`) | **H** |
| T2 | `runner-helpers/loop-resolution.ts:139,296` + `reflect/loop-detector.ts` | repeated tool/thought pattern | **H** |
| T3 | `loop/turn-guard-operations.ts:291` low_delta_guard | 2 consecutive low token delta | **H** |
| T4 | `turn-guard-operations.ts:342` switching_exhausted | strategy switch budget | H |
| T5 | `turn-guard-operations.ts:618` oracle_forced | ignored readyToAnswer signals | H |
| T6 | `loop/iterate-early-stop-seam.ts:105` dispatcher_early_stop / controller_early_stop | RI controller (entropy) verdict | **H** |
| T7 | `loop/enumeration-abstain-exit.ts:40` | enumeration count parsed from prose stalls past patience | H (count) x E (no progress) |
| T8 | `loop/broken-tool-exit.ts:46` required_tool_quota (give-up streak) | required tool failed N times | E |
| T9 | `turn-guard-operations.ts:796` requiredToolRedirects quota | required tool never called after N nudges | D/E |
| T10 | `exit-gate.ts:920` proposeCapExit max_iterations | iteration cap | D |
| T11 | `turn-guard-operations.ts:111`, `runner-helpers/pace-terminal.ts:135`, `iterate-control-plane-seams.ts:51`, `iterate-run-ctl-checkpoint.ts:44`, `iterate-before-think-seam.ts:61` zero-evidence stand-down, pace terminal, control-plane abstain, run-ctl stop | harness-authority exits, always accepted (`exit-gate.ts:232`) | mixed D/E; zero-evidence discriminator H |
| T12 | `capabilities/decide/abstention-detection.ts:26` via `arbitrator.ts:397` | final-answer text looks like a decline | **H** |

### Can accept success
| # | Site | Trigger | Basis |
|---|---|---|---|
| A1 | `decide/model-exit-proposal.ts:75` + `exit-gate.ts:566` (`outstanding.length===0 -> accept`) | model writes a final answer and V1-V7 are clear | model claim, gated by D/E (+H) |
| A2 | `reflect/loop-detector.ts:400-441` checkAllToolsCalled, enabled `strategies/plan-execute/step-executor.ts:492` | every available primary tool is in `state.toolsUsed` (written BEFORE execution, see `terminal-gate.ts:32-40`) | **weak E: attempt, not receipt** |
| A3 | `exit-gate.ts:566/587` accept of a stall/loop/low-delta/early-stop proposal when nothing outstanding | guard fired AND V1-V7 clear | H trigger, ships as success |
| A4 | `execute-success-invariants.ts:104-117` partial + non-empty output -> success tolerance lane | kernel `partial` with any text | H (any non-empty text) |
| A5 | `execute-success-invariants.ts:206-217` deliverablesAreTheAnswer | all declared deliverables produced | D/E |
| A6 | `exit-gate.ts:894-911` answerTurnReplyExit | budget answer turn reply with nothing outstanding | as A1 |

## 2. Computations (campaign, n = 321 terminal outcomes)

Mismatches (outcome vs grader): **121/321 = 38%** = 109 false success (FS) + 12 false failure (FF). Of the 109 FS, 98 earned partial grader credit (0.17-0.91), 11 scored 0. Base rate of unsolved: 132/321 = 41%.

### (1) Mismatches by deciding basis

| Deciding basis | n | share of 121 |
|---|---|---|
| Model-final accepted, all D/E gates passed (A1; `end_turn` 48 + `final_answer` 32): content wrong/partial beyond any declared criterion | 80 | 66% |
| H-triggered terminate shipped as success (A3: stall 16, RI/dispatcher 4) | 20 | 17% |
| Attempt-based accept (A2 `all_tools_called`, 9 of 9 wrong; 5 of the 9 had failed file-read/write calls) | 9 | 7% |
| H veto (FF): output-not-* prose gate 7 (rw-6), floor-`answer`/narration stall 2 (rw-7 qwen3.5) | 9 | 7% |
| D/E veto (FF): lh-1 required `web-search` never succeeded (2), iteration cap partial (rw-4, patched) | 3 | 2.5% |

Veto side only: **9 of 12 wrong vetoes (75%) are H-basis**. Accept side: **29 of 109 wrong accepts (27%) came from an H or attempt-based path**; 73% from a model-final accept that D/E gates passed.

Ablation supplement (older code, 245 non-ab-trap): 40 FF, 30 of them the SideEffectLanded `action-required` veto (V3). That is 12 unique cells seen in 3 arms; **veto precision 0/12 unique cells (0/30 observations)**. Same arms: prose gate 9 FF.

### (2) Precision of H-basis veto/terminate (is the run actually bad?)

| Trigger | n | unsolved (bad) | lift vs 41% base | shipped as success | wrong as success |
|---|---|---|---|---|---|
| T1 stall guard | 32 | 23 (72%) | 1.75x | 21 | 16 (76%) |
| T6 RI/dispatcher early stop | 18 | 12 (67%) | 1.6x | 10 | 4 |
| V9 prose verifier veto (output-not-*) | 10 | 3 (30%) | **0.7x (worse than base)** | 0 | 0 |
| A2 all_tools_called | 9 | 9 (100%) | - | 9 | 9 (100%) |
| V3 action-required (ablation) | 12 cells | 0 | 0 | 0 | 0 |
| Reference: model-final | 201 | 80 (40%) | 1.0x | 201 | 80 |
| Reference: D/E abstain/required-tool | 50 | 4 (honest failures; 46 ab-trap abstentions solved) | - | 0 | 0 |

Reading: stall/early-stop are decent predictors of a bad run (so ending them is cost-efficient), but they are then LABELED success 21 + 10 times. The prose number-extraction veto is worse than a coin; and the same check flagged 11 accepted runs where 7 were bad: combined 21 flagged, 10 bad (48% vs 41% base), i.e. near zero signal at n=21 (SE about 11pp). Cost of removing heuristic TERMINATE power (stall/dispatcher): counterfactual is unknowable zero-token; these runs are 70% bad, so removing them risks burning tokens (see ignored-enumeration run `01M7BMXFY8350ZFQQQTF63DAEQ`: 47 iterations, 214 s, ended failure anyway). Cost of removing heuristic VETO power (V3, V9-prose): 0 to 3 truly-bad runs lost, 19 wrongly vetoed good runs recovered (7 + 12 cells).

### (3) Correct failures: which basis produced them (68 TN: 46 ab-trap abstentions, 22 other)

| Basis present in outstanding | n | share |
|---|---|---|
| D/E only (required tool unavailable/never run, derived call-the-tool item) | 54 | 79% |
| D/E plus an H item also listed (declared item alone would have failed it) | 9 | 13% |
| H only (narration/floor answer 2, prose gate 3) | 5 | 7% |

93% of correct failures stood on a declared/evidence item. Also `task-text` artifact-path requirements, though prose-derived, vetoed 6/6 correctly: a literal path anchor checked against a file-write receipt is high precision, unlike the verb/noun and number-regex derivations.

### (4) Positive-claim acceptance (240 success-ended runs)

- 0/240 lacked a receipt for any declared artifact; 0/240 lacked a successful call to a declared required tool; 240/240 had at least one successful non-meta call. **Declared-claim acceptance without receipts did not occur.**
- Not covered by receipts: undeclared claims. 59 runs shipped success after a `verified:false` verdict from a non-gating check (28 solved, 31 not: 47% good, no better than base). Failed-check counts among success-ended: listed-entities 38 (26 solved), nli 52 (23 solved), fabricated-measurement 11 (4 solved).
- A2 accepts on ATTEMPT (`toolsUsed`), 9/9 wrong.
- Code-level hole (no trace): `claimed-actions.ts:147-148` returns no claims when the surface has no non-meta tool, so an answer asserting "email sent" with an empty surface is never unbacked. The claim detector iterates the TOOL LIST to find claims instead of using the ledger as authority.
- Receipt integrity: in lh-1 (`01M7BPDFCEXW00Y46XNKCNNFZH`) `tool-call-end.ok=true` was recorded for web-search at seq 495 for the harness's own "you have already called web-search 7 times" text. It did not satisfy coverage (outstanding still listed `tool:web-search`) but any consumer counting `ok` (e.g. my nOk, or `isSideEffectLanded` ledger `success`) can be fooled. Boundary check recommended.

## 3. The six wrong outcomes

| Outcome | In corpus? | Basis | State |
|---|---|---|---|
| SideEffectLanded over-derivation (12 false failures) | ablation arms only | H derivation (V3) | narrowed at HEAD `d1eb475e9`; still H with veto power |
| qwen3:4b lh-1 `runtime-success-veto:outstanding-criteria` (2 cells) | yes | **D/E**: required web-search never succeeded (all 8 real attempts errored "no results", the 9th `ok` was guard text). Harness was right; grader hidden test only checks files; model claimed "cross-checked sources" | NOT a heuristic fault; grader blind spot / env |
| gpt-oss rw-4 answerSatisfied veto | yes (1 cell) | H (`answerSatisfied`, last-turn shape) over E (output.ts written) | fixed `e7c812dce` (`execute-success-invariants.ts:206`) |
| qwen3.5 rw-7 `stall_deliverable` (2 cells) | yes | H: T1 stall + V7 default floor `answer` on a task with no declared file deliverable; 11-14 successful tool calls, no draft, so handoff = `failed` | open |
| Ignored enumeration abstain | yes (gpt-oss lh-1 run0) | H count ("expects 6 items") + T1; run correctly failed but 41 wasted iterations | fixed `2bbeb2d33` |
| Fabricated "email sent", empty surface | no trace | H detector fail-open (`claimed-actions.ts:147`) | open |

Of the 5 outcomes with an actual wrong result, 4 have an H basis; 1 is harness-correct.

## 4. Verdict

Supports: wrong vetoes are overwhelmingly H-basis (9/12 campaign, 30/30 SideEffectLanded observations); the one named positive-claim hole (empty surface) is real; A2 accepts on attempts 9/9 wrongly; correct failures are 93% declared/evidence-backed, so the "block only on declared or evidenced basis" half of the principle is consistent with the data.

Refutes (as the main cause): the failure class "run ended with wrong status" is 91% FALSE SUCCESS, and 66% of mismatches sit behind gates that all passed. Declared receipts are already enforced (0/240 misses). The real gap there is that a task's success is graded on properties the contract never declared (e.g. rw-2 rubric: "stock-out identified"). No termination refactor can fix that; it needs declared acceptance criteria (or a judge) and honest partial status, which is a different program.

Distinction the data adds: the line is not "prose-derived vs declared". Prose-derived LITERAL anchors checked against a receipt (artifact paths, 6/6) work; prose-derived SEMANTIC categories (verb x noun, number-extraction, enumeration counts, default `answer` floor) do not (0/12, 30%, near-coin).

## 5. Smallest change set (for the parent to dispatch; nothing edited here)

Principle as a rule: a requirement may hold veto power only if it is declared (builder/contract) or is a literal anchor checkable against a receipt; semantic prose inferences advise through PendingGuidance and never gate.

1. Demote `unlandedActionRequirements` (`exit-gate.ts:324`, `satisfiability.ts:117`) and derived `sideEffectLanded` (`derive-conditions.ts:695`) to advisory unless the action is declared via `requiredTools`/taskContract. Replaces the clause-narrowing patch with a rule. Owner: kernel-warden.
2. Verifier prose checks `output-not-fabricated-measurement/listed-entities/continuation-intent` (`verifier.ts:582,639,683`): never `reject` on their own; they set a warning on the receipt and `PendingGuidance`. Block only `unbacked-action-claim` (E-backed). Owner: kernel-warden.
3. V7 floor `answer`: when every declared item has receipts and only the floor is outstanding, handoff ends `partial` with `Unfinished:`, not `failed` (`exit-gate.ts:784-841`, `:268`). Owner: kernel-warden / runtime-warden for the status fold.
4. Claim detection (`claimed-actions.ts:147-148`, `exit-gate.ts:329-335`): make the ledger the authority: an action-claim sentence with zero successful non-meta receipts is unbacked regardless of surface contents. Owner: kernel-warden.
5. A2 (`loop-detector.ts:400`, `step-executor.ts:492`): count successful receipts, not `toolsUsed`. Owner: kernel-warden.
6. Receipt boundary: guard-synthesized tool replies must not be recorded `ok:true`/`success:true` in the ledger. Owner: kernel-warden / tools-warden.
7. Grader/bench: lh-1 hidden test does not check that web-search ran; mine as harness-warden (`packages/benchmarks`), not a harness defect.

Items 1, 3 and 4 alone would have prevented outcomes 1, 4 and 6 and made 3 and 5 structural instead of patched. Outcome 2 needs nothing.

## 6. Risks

- Removing V9 reject loses 3 truly-bad rw-6/rw-2 runs in the campaign (fabricated measurements that were really fabricated); with fabMode=block these are exactly the dishonest-number cases the owner cares about. Keep them as a hard claim-vs-ledger comparison only when the number appears nowhere in any observation AND the output asserts it as measured; otherwise warn.
- A3: relabeling stall-ended runs as partial would convert 21+10 successes with 20 wrong into partials; the 9 correct ones lose their success label. Net positive but it is a metric-moving change: run it as an ablation (ablation-warden bar: 2 tiers, 3pp).
- Evidence is from 9 local models on 17 tasks; frontier tiers not represented. Success mismatch rates will differ.
- My basis labels are post-hoc; the trace has no `basis` field. Cheap follow-up: stamp `basis: declared|evidence|heuristic` on each outstanding item and guard event so this audit becomes a zero-token query (trace schema belongs to the producing warden).
