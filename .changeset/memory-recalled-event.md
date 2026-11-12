---
"@reactive-agents/memory": minor
---

`MemoryService.bootstrap` accepts an optional `taskId` and, when given, publishes the core `MemoryRecalled` event once per non-empty recalled tier (semantic, episodic, procedural) with bounded items (max 20, summaries max 160 chars). Nothing is published when nothing is recalled.
