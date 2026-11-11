---
"@reactive-agents/memory": patch
---

Re-storing a skill no longer deletes its version history. `SkillStoreService.store` now upserts instead of using `INSERT OR REPLACE`, which cascaded a delete through `skill_versions`; an existing skill keeps its original `createdAt`. `SkillStoreService.update` accepts `evolutionMode`, so a skill can be locked or unlocked in place.

Memory search finds short words: `toFts5Query` keeps terms of 2+ characters (`bun`, `ai`, `db`) and drops common stop words instead of every word under 4 characters. Zettelkasten auto-linking keeps its 4-character floor.

`SemanticMemoryService.listByAgent(agentId, limit, { taskId, runId })` and `ProceduralMemoryService.listActive(agentId, { taskId, runId })` take an optional provenance filter.
