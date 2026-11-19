---
"@reactive-agents/runtime": minor
---

`agent.resumeRun(runId, { newRun: true })` continues a run as a new run. It gets its own run id (`<runId>-cont-<8 hex>`, in `result.runId`) and its own trace file, and `result.continuedFrom`, the run's `listRuns()` row and `run-started.config.continuedFrom` name the parent. Guidance, `note`, `extraIterations`, completed-tool-call recovery and the config-hash guard are unchanged, and the parent run's record is untouched. Without the option, resume behaves as before (same run id).
