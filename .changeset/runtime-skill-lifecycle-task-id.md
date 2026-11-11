---
"@reactive-agents/runtime": patch
---

`SkillPromoted` and `SkillRolledBack` events published at the end of a run now carry that run's `taskId`, so observers can link a skill's lifecycle change to the run that caused it. `SkillRefined` from a manual `agent.refineSkills()` call has no `taskId`. Run-end rollback now waits for at least 3 uses since refinement, so one failure right after a refine no longer reverts it.
