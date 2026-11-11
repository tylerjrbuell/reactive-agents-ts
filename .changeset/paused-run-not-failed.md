---
"@reactive-agents/runtime": patch
---

A run paused at an approval gate or a pending interaction no longer reports itself as failed. It used to publish `AgentCompleted` and `TaskCompleted` with `success: false` and an error such as "A declared deliverable was not produced.", so every bus subscriber recorded a waiting run as failed. A paused run now publishes no terminal event, carries no `error`, and the runtime's deliverable, required-tool and empty-output checks no longer run on it. Read the pause from the result's `status` and `pendingApproval` / `pendingInteraction`. The resumed run publishes its terminal events when it ends.
