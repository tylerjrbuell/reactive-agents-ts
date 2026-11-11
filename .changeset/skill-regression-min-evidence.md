---
"@reactive-agents/memory": patch
---

Skill regression rollback now needs evidence. `SkillEvolutionService.checkRegression` rolls a refined (candidate) skill version back only after it has at least 3 uses since refinement and its success rate is below the rate at refinement. A single failure right after a refine no longer reverts it. Tune the bar with `makeSkillEvolutionService(llm, { regressionMinUses })` (`DEFAULT_REGRESSION_MIN_USES` = 3). Skill versions now record the skill's use count at refinement (new nullable `skill_versions.use_count_at_refinement` column, added in place on existing databases; legacy rows count every use, the old behavior). `useCountAtRefinementOf(version)` reads it.
