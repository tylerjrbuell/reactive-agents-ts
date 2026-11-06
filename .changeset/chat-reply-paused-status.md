---
"@reactive-agents/runtime": patch
---

A tool-path `ChatReply` now reports a durable pause.

- `agent.chat(msg, { useTools: true })` and `session.chat(...)` return `status`, `pendingApproval` and `pendingInteraction` from the run, the same shape as a paused `StreamCompleted`. A run paused at an approval gate gives `status: "awaiting-approval"` and `pendingApproval: { runId, gateId, toolName, args }`. Before this, the reply had no way to tell a pause from a final answer.
- The engine completion log now says `Task paused awaiting approval (<tool>)` or `Task paused awaiting interaction (<kind>)` for a paused run. Before this, it said `Task failed`. The run's `success` value does not change.
