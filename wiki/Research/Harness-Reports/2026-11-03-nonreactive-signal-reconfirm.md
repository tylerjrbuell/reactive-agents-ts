---
type: harness-report
status: complete
created: 2026-11-03
tags: [harness-report, signal-confirmation, non-reactive, terminal-outcome]
---

# Non-reactive terminal-signal reconfirm, 2026-11-03

Live reconfirm of commits d2e2bd795, 7b46fb9b4, 9513c811d on plan-execute-reflect, reflexion, tree-of-thought, adaptive.
Model: `llama3.2:3b` (local Ollama; only model used before). 12 cells = 4 strategies x {file task r0, file task r1, plain task r0}. n tiny, presence/consistency checks, not rates. No code edited.
Probe: `wiki/Research/Prototypes/signal-confirmation-2026-11-03/probe3.ts` (probe2 + TASK/REP args). Tasks: `file` = write hi.txt then read back; `plain` = "17 times 3 and capital of France" with file tools available.
Traces: `wiki/Research/Harness-Reports/2026-11-03-nonreactive-signal-reconfirm-traces/<cell>/{trace,cell.json,result.json}`.
Dist check: `packages/reasoning/dist/index.js` (11:19) contains `relayedOutcomeOf` and `answerBlessed` (9513c811d symbols), so dist is current despite commit time 11:27.
Instrument note: my first summary showed 0 terminal_decision events because it filtered `kind==="terminal_decision"`; they are `guard-fired` events with `guard:"terminal_decision"`. Probe fault, fixed; present on every cell.

## Verdict

- No `terminal-mislabel` label and no status/outcome contradiction on any of 12 cells. Fixes of d2e2bd795 and 7b46fb9b4 CONFIRMED live: outcome populated with `status, authority, kernelAuthority (on vetoes), outstanding, statusReason` on 12/12 incl. adaptive and ToT; `tolerated`/`toleratedBy` present on 3/3 plan-execute successes with partial kernel status.
- 9513c811d reflexion plain-answer veto: NOT reproducible here. Reflexion file cells succeeded with `outstanding:[]` and verified deliverable (consistent, weak evidence); the plain cell abstained for another reason (model emitted raw tool-call JSON as text). Verdict INCONCLUSIVE for the answer-floor veto specifically.
- 9513c811d adaptive relay: CONFIRMED. adaptive outcome carries sub-strategy fields (kernelAuthority, outstanding ids, statusReason) on 3/3, status agrees with run-completed.
- Open concerns (below): C1 tolerance too lenient when output admits failure (plan-execute); C2/C3 cause classifier mislabels (2 of 12); C4 ToT fails correct plain answer.

## Per-cell table

| Cell | run-completed | outcome.status / authority (kernelAuthority) | outstanding | tolerated | cause (confidence) | Notes |
|---|---|---|---|---|---|---|
| plan-execute file r0 | success / end_turn | partial / model-final | [] | true, partial-substantive-output | none (probable) | output says file "not found"; see C1 |
| plan-execute file r1 | success / end_turn | partial / model-final | [] | true, partial-substantive-output | none (probable) | output says "unable to write"; see C1 |
| plan-execute plain r0 | success / end_turn | partial / model-final | [] | true, partial-substantive-output | none (probable) | answer correct (51, Paris); kernel partial, tolerated |
| reflexion file r0 | success / controller_early_stop | completed / guard:dispatcher_early_stop | [] | absent | none (decisive) | output correct, deliverable pass verified |
| reflexion file r1 | same | same | [] | absent | none (decisive) | same |
| reflexion plain r0 | failure / abstained | abstained / runtime-success-veto:abstained (give-up-gate) | [] | absent | budget-cap (decisive) | output = raw tool-call JSON text; see C2 |
| ToT file r0 | failure / harness_deliverable | partial / runtime-success-veto:outstanding-criteria (gate-verdict) | [answer, output-is-model-authored] | absent | stall-after-work (decisive) | consistent, output correct but harness-authored |
| ToT file r1 | same | same | same | absent | stall-after-work | same |
| ToT plain r0 | failure / harness_deliverable | partial / runtime-success-veto:outstanding-criteria (gate-verdict) | [answer, output-is-model-authored] | absent | wrong-tool-arg (decisive) | output correct (51, Paris); see C3, C4 |
| adaptive file r0 | failure / harness_deliverable | partial / runtime-success-veto:terminal-outcome (gate-verdict) | [answer, output-is-model-authored] | absent | stall-after-work (decisive) | outcome relayed |
| adaptive file r1 | same | same | same | absent | stall-after-work | same |
| adaptive plain r0 | success / end_turn | completed / model-final | [] | absent | none (decisive) | deliverable pass verified |

Plan-execute: terminal_decision now emitted (`status:done, finalStatus:partial, authority:model-final`), but there is still no kernel `verifier-verdict` and no `deliverable_decision` guard event (classifier `missing:["deliverable_decision"]`, confidence only "probable"); `outcome.deliverable/verifierVerdict/verdict` are null.

## Findings

- C1 (real, runtime/kernel): plan-execute file r0/r1 ship `success:true` with output that states the task failed ("not found", "unable to write"). Cause: plan ran file-read (iter 1) before file-write (iter 0 trace stamp), ENOENT, model reported honestly. `tolerated:true / partial-substantive-output` marks it, so no mislabel by design, but the tolerance heuristic accepts a self-declared failure; runtime verifier said "10 checks passed". Also `outcome.success:false` vs `run-completed.status:success` is the tolerated case: disclosed, not hidden. Dispatch kernel-warden/runtime-warden to judge whether substantive-output tolerance should exclude outputs that disclaim the task.
- C2 (classifier false positive): reflexion plain labeled `budget-cap` with evidence "iteration 2/3 capped=false; evidenceDelta>0=false". terminatedBy is `abstained`, capped is false, so budget-cap contradicts its own evidence. Expected: abstention/give-up label. Anchor: `packages/diagnose` / `packages/trace` cause classifier (no warden; parent decides).
- C3 (classifier false positive/priority): ToT plain labeled `wrong-tool-arg` though `stall_deliverable 4/4` fired and the run ended via harness_deliverable; the same ending on ToT/adaptive file cells is labeled `stall-after-work`. Early file-read ENOENT calls on a task with no files outrank the actual ender. Same anchor as C2.
- C4 (behavior): ToT plain gave the correct answer, yet failed (model looped file-read/file-write on a no-tool question until stall, harness assembled output). Veto is honest per rules (never produced a model-authored final); nothing to fix in signals. Tolerance is not applied here (kernel status partial but authority outstanding-criteria veto), unlike plan-execute plain which is tolerated; inconsistent across strategies for equal shape. Worth a look by kernel-warden.
- Not covered: n=1 per cell/task, one 3B model, no frontier tier; reflexion outstanding-answer veto and `statusReason` on a real reflexion veto-by-outstanding not reproduced; tolerated on reflexion/ToT/adaptive not seen.

## Machine-greppable summary

```
RECONFIRM cells=12 model=llama3.2:3b strategies=plan-execute-reflect,reflexion,tree-of-thought,adaptive
RECONFIRM terminal_mislabel=0 contradiction=0
RECONFIRM outcome_fields_present=12/12 (status,authority,outstanding,statusReason)
RECONFIRM kernelAuthority_on_veto=7/7 tolerated_present=3/3 (plan-execute only)
RECONFIRM adaptive_outcome_populated=3/3
RECONFIRM reflexion_plain_answer_veto_fix=INCONCLUSIVE (not reproduced)
RECONFIRM classifier_false_positive=2 (reflexion-plain budget-cap; tot-plain wrong-tool-arg)
RECONFIRM concern_tolerance_admits_failure=2 (plan-execute file r0,r1)
RECONFIRM verdict=PARTIAL-CONFIRMED
```
