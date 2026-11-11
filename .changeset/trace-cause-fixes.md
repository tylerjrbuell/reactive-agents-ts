---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": patch
---

Failure causes and loop counts now match what the run did.

- A run that wrote `run-aborted` without a `reason` is `aborted`, not `incomplete-trace`. A guardrail block shows as `aborted/guardrail-block`; other aborts show as `aborted/<causeClass>`, rated `probable`, with `run-aborted.reason` listed as missing. `incomplete-trace` now means only that the trace has neither `run-completed` nor `run-aborted`.
- A token or cost budget stop (`budget_exceeded`, `budget-limit:*`) is `budget-cap/token-budget`, `cost-budget` or `spend-budget`. Its next step no longer says to raise the iteration budget. `causeDescription(cause, subCause?)` takes an optional sub-cause and returns the more specific wording; `rax-diagnose cause` passes it.
- `traceStats().iterations` (and `analyzeRun().iterations`, replay `TraceSnapshot.iterations`) counts loops the way the event stream does. It counts `iteration-exit` records, which `ReasoningIterationProgress` now writes to the trace. Older traces use their kernel snapshots, which fixes a count that was one too high on every kernel run. plan-execute-reflect runs no longer show 0 loops.
- The trace now records `StructuredOutputReported` as a `structured-output-reported` event, and `ToolCallStarted.args` as `args` on `tool-call-start`.
