---
"@reactive-agents/core": patch
---

`AgentMemoryEntry` (the `AgentMemory` port input) gains optional `taskId` and `runId` fields that record which run wrote the entry. Existing producers and adapters compile unchanged; adapters that do not store provenance ignore the fields.
