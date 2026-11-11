---
"@reactive-agents/core": patch
---

`SkillActivated` gains optional `taskId` (the run the activation belongs to) and `sha256` (hash of the injected SKILL.md body) fields, so observers can tie an activation to a run and a skill version. Existing producers and subscribers compile unchanged.
