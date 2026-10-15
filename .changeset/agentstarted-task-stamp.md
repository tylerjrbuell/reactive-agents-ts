---
"@reactive-agents/core": patch
"@reactive-agents/runtime": patch
"@reactive-agents/trace": patch
"@reactive-agents/replay": patch
---

GH #236: `run-started` trace events now carry the real task/prompt end-to-end. `AgentStarted` gains an optional `task` (+ `taskTruncated`) field, the execution engine stamps the run's prompt at the emission site (capped at 64KB, same publisher-side budget convention as `AgentCompleted.output`), and the trace normalizer consumes `raw.task ?? ""` (empty-string back-compat for pre-fix emitters and hand-rolled events). Fresh recordings load through `loadRecordedRun` with a faithful `RecordedRun.task`, so `replay()` orchestrates the actual prompt instead of a blank; the committed replay CI-lane golden was regenerated through the real recorder and the first-llm-exchange workaround removed.
