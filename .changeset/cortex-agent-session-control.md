---
"@reactive-agents/cortex": minor
---

Cortex chat gains opt-in agent session control. Turn it on per chat with `/agent on` ("Let the agent manage this chat"); it is off by default and stored as `agentControl` in the session config. When on, the agent can propose goal, loop/schedule and config changes. Each proposal shows inline in the chat as a card with Apply and Dismiss; nothing changes until you click Apply, and a failed Apply leaves the proposal pending with its error. Applying refreshes the goal bar, schedules and session config. No claim is made that small local models propose correctly or reliably; this is unmeasured.
