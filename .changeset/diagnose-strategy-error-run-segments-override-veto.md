---
"@reactive-agents/trace": patch
"@reactive-agents/diagnose": patch
---

`rax-diagnose cause` and `attribute` now read three run shapes correctly:

- **Strategy errors.** A strategy body that fails (for example, code-action refusing `.withApprovalPolicy({ mode: "detach" })`, or reflexion's synthesis fallback failing) is the decisive cause `strategy-error`, with sub-causes `config-refused`, `synthesis-failed` or `body-error`. Before, it read `undetermined / insufficient-trace`, or the inner pass's iteration cap. A body that failed on a model call (`LLM call failed`) is a probable `provider-error`.
- **Several runs under one runId.** A trace file holding several runs (Cortex "Continue" reuses the runId) is split at each `run-started`. `cause` and `attribute` report the last run with a note (`2 runs share this runId; this is run 2 of 2`). `--segment=<n|all>` picks a run, and `--all` cohort mode counts each run once. Before, one report mixed the first run's start with the last run's end and summed tool counts across both. `analyzeCause` and `attributeFailure` read the last run. New exports: `runSegments`, `lastRunSegment`, `withRunSegment`, `runSegmentNote` and `CauseAnalysis.runSegment`.
- **Status override on a verified answer.** When a `terminal_status_override` (`labelsDisagree: true`) fails an answer whose terminal meant to deliver and whose deliverable gate passed, the cause is now `terminal-mislabel/status-override`, attributed `harness:terminal-mislabel`. Before, it read `budget-cap/cap-cutoff` ("raise the iteration budget").
