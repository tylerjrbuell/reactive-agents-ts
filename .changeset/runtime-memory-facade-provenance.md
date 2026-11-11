---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`agent.memory()` lists, searches, edits and deletes what an agent has stored. `search(query, { limit?, taskId?, runId? })` runs a full-text search over semantic memory; `semantic` and `procedural` each have `list`, `get`, `update` and `delete`; `episodic.list()` reads the event log. Entries come back with the `taskId` and `runId` of the run that wrote them. The agent needs `.withMemory()`; without it every call rejects with the new `MemoryNotEnabledError`.

Memory the runtime writes during a run now records that run: facts extracted at the end of a run, skill fragments learned from it, and tool-driven memory writes all store the run's `taskId` and `runId`.
