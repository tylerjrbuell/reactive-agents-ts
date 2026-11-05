---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

`rax-diagnose attribute` and `attributeFailure` share one failure taxonomy with `rax-diagnose cause`. When no turn-level rule fires, a failed run is attributed through its failure cause's owner (`CAUSE_ATTRIBUTION`, reported `probable`, with the cause in `cause` / `from-cause`), so a run the cause classifier already explained (an abort, a provider error, a model that never called a tool, a loop after the work was done) no longer reads `unattributed`. On a local corpus of real traces, unattributed failures dropped from 95 of 97 to 22.

- New verdict `environment` (`environment:{run-aborted, provider-error, budget-cap, tool-failure}`): failures outside both the harness and the model. `AttributionTally.byVerdict` gains `environment`.
- New reason `model:fabrication-vetoed`: the run's own fabrication check refused the model's answer. It was reported as `harness:false-veto` whenever a grader passed only part of the task.
- New reason `harness:subpass-abstained`: a kernel pass abstained before its first LLM call and the run kept going on top of it.
- `loadTrace` keeps one copy of an event written twice (same run and `seq`), as a timed-out run's sink can do; sums over events no longer double-count.
