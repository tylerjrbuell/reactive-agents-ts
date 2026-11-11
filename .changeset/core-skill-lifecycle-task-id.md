---
"@reactive-agents/core": patch
---

`SkillPromoted`, `SkillRolledBack` and `SkillRefined` gain an optional `taskId` field: the run whose outcome triggered the lifecycle change. It is absent for manual `refineSkills` passes. Observers can now tie a promotion, rollback or refinement to the run that caused it. Existing producers and subscribers compile unchanged.
