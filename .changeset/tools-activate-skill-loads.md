---
"@reactive-agents/tools": minor
---

`activate-skill` now loads the skill instead of acknowledging the request. It takes `{ name, file? }`: `{ name }` returns the skill body (kept through context compaction, "already loaded" on a repeat, refused with a pointer to `file` when over budget); `{ name, file }` reads one file inside that skill's directory only. `makeActivateSkillHandler` and `readSkillFile` are new exports. Removed: `activateSkillHandler` (the stub) and the `get-skill-section` tool, which `file` replaces; `parseSections` and `getSkillSection` remain as deprecated exports for one release.
