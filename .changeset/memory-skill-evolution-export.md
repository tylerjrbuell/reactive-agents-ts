---
"@reactive-agents/memory": patch
---

`SkillEvolutionService` and `makeSkillEvolutionService` are now exported from the package root. `refine()` records the current version as an "active" history entry before adding the candidate, so `checkRegression()` can roll back after a first refinement. `checkPromotion()` no longer promotes skills with `evolutionMode: "locked"`.
