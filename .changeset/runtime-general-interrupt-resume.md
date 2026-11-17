---
"@reactive-agents/runtime": minor
---

Any durable run that did not complete can be continued where it left off with `agent.resumeRun(runId, { note?, extraIterations? })`: a user stop or pause, an error, a spent iteration budget, a timeout, a loop stop or a crash. The run row and `result` carry a typed `stop` record (`kind`: `user-paused`, `user-stopped`, `error`, `crash`, `loop`, `budget`, `timeout`), `RunStatus` gains `stopped`, and `resumable` is true for every non-completed run that has a checkpoint. New `agent.pauseRun(runId)`, `agent.stopRun(runId)` (take effect at the next iteration boundary; a running tool finishes and is journaled) and `agent.activeRunIds()`. An interrupted run's final checkpoint is the state after its last finished iteration, so resume repeats no completed step; a failed tool call is not recorded as done. A resumed run is a durable run again (checkpointed, live, pausable). A run that ends with a failed result is now marked `failed` (it was `completed`). `resumeRun` options are refused only for a run that already completed.

Also: `agent.plan({ strategy: "blueprint" | "plan-execute-reflect" })` plans with that strategy's own planner (no tool runs) and returns its plan; `commandPolicy` of a command-running tool now reaches the kernel tool schema so plan prompts can show the allowed executables.
