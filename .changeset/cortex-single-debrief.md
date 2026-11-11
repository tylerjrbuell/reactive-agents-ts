---
"@reactive-agents/cortex": patch
---

A desk run or saved-agent (gateway) run now stores one debrief, not two. The framework publishes `DebriefCompleted` on the agent's event bus, which Cortex already forwards; Cortex no longer adds a second copy from the run result.
