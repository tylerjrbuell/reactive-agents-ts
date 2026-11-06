---
"@reactive-agents/runtime": minor
---

Workspace, pause outcome and run evidence follow-ups.

- Chat turns take a per-turn `workspace`: `agent.chat(msg, { useTools: true, workspace })`, `session.chat(...)` and `session.runStream(msg, { workspace })`. Precedence is turn, then `.withTools({ workspace })`, then ambient `withFileRoot()`. `agent.chat()` on the tool path now also forwards `posture` and `origin` to the run. Before this, both were dropped.
- Durable runs store their per-run `workspace`. `resumeRun`, `approveRun`, `denyRun`, `respondToInteraction` and `fork` run in that directory again, from any process. Before this, they fell back to the builder or ambient root.
- A durable run paused for approval or interaction now reports `success: false` and no `terminatedBy` on both `run()` and `runStream()`. `StreamCompleted` carries `status: "awaiting-approval" | "awaiting-interaction"`. Before this, a paused stream reported `success: true, terminatedBy: "end_turn"`. `AgentStream.collect()` now carries `status`, `pendingApproval` and `pendingInteraction`.
- New `AgentResult.evidenceDelta` (and on `StreamCompleted` and a tool-path `ChatReply`): the run's summed kernel assessment evidence. `goalRunOf()` prefers it over re-summing events. A tool-path `ChatReply` now carries `goalAchieved` and `outstandingCriteria` too, so `goalRunOf(reply)` honors the run's exit gate.
