---
"@reactive-agents/reasoning": patch
---

`SkillActivated` events for skills the model loads with `activate-skill` now carry the run's `taskId` and the `sha256` of the activated SKILL.md body, matching bootstrap activations. Observers can tie an agent-loaded skill to its run and its exact version.
