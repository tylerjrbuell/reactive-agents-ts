---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

A run that a loop guard stopped can now be continued. On a `.withDurableRuns()` agent, `agent.resumeRun(runId, { note?, extraIterations? })` resumes a loop-stopped run from its final checkpoint with corrective guidance (what was done, what is unfinished, what not to repeat; the original task is the goal), appends `note` to that guidance, and gives the continued run a fresh iteration budget (`extraIterations`, default 10). Completed tool steps are not re-run. Passing options for a run that did not loop-stop fails the new `RunNotResumableError`; plain `resumeRun(runId)` is unchanged.

`AgentResult` gains `runId`, `loopStop` (reason, repeated tool, tools done, unfinished, iteration) and `resumable`. `listRuns()` rows gain `loopStop` and `resumable` (new `loop_stop_json` column, added by a guarded migration). Tool-path `ChatReply`s carry the same fields, and the history note for a failed loop-stopped turn says what was done and that Continue is available (`ChatMessage.runId` / `resumable`).
