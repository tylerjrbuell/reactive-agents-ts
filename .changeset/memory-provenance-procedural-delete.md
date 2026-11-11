---
"@reactive-agents/memory": minor
---

Semantic and procedural memory rows now record which task and run wrote them. `SemanticEntry` and `ProceduralEntry` gain optional `taskId` and `runId` fields, stored in new nullable `task_id` / `run_id` columns. Existing databases migrate on open: the columns are added in place, old rows are kept and read back with no provenance, and full-text search keeps working. `MemorySource` gains an optional `runId`, and `provenanceFromSource(source)` turns a source into the fields to spread into an entry.

`ProceduralMemoryService.delete(id)` removes a learned workflow. `SemanticMemoryService.search(options)` runs a full-text search (LIKE fallback on Node's built-in sqlite) whose results carry provenance. `SearchOptions` accepts `taskId` / `runId` to narrow results to what one task or run wrote, and `MemorySearchService.searchSemantic` honors them too.
