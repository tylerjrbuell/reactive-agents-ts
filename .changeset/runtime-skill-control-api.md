---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Agents gain skill control methods. `agent.rollbackSkill(name)` restores a stored skill's previous version and publishes `SkillRolledBack` with `reason: "manual"`. `agent.setSkillMode(name, mode)` locks (`"locked"`) or unlocks (`"auto"`, `"suggest"`) a skill in place, keeping its version history. `agent.loadSkill(path, { evolutionMode })` sets the mode of a loaded skill (new skills still default to `"locked"`), and reloading a skill the agent already stores now keeps its version history, stats and confidence instead of resetting it to version 1; changed instructions become a new version. `agent.memory().semantic.list()` and `procedural.list()` accept `taskId` / `runId` filters, applied in the store query.
