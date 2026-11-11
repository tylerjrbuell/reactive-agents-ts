---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Stored skills now evolve. After each run, a used SkillStore skill is promoted (tentative to trusted, trusted to expert) when it crosses the confidence thresholds, publishing `SkillPromoted`; a refined version whose success rate falls below its rate at refinement rolls back to the previous version, publishing `SkillRolledBack`. `agent.refineSkills()` now actually refines: with memory on it rewrites each eligible skill's instructions through the agent's own LLM, saves a new candidate version, publishes `SkillRefined`, and resolves `{ refined, unchanged, skipped, failed }` (exported as `SkillRefinementResult`) instead of `{ refined: 0 }`. Everything stays opt-in: it needs memory on and `skillPersistence` not `false`, and refinement only runs when you call `refineSkills()`.
