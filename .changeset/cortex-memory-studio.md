---
"@reactive-agents/cortex": minor
---

Memory studio: a Lab **Memory** tab to search, browse, edit and delete an agent's stored memory (facts, workflows, log), each entry linked to the run that wrote it. The run view's Memory tab now lists the memories that run wrote. All reads and writes go through the framework's `agent.memory()`; Cortex no longer opens a cwd-relative `.reactive-agents/memory/<agentId>/memory.db` (it found nothing for agents using the framework's `~/.reactive-agents` default).
