---
"@reactive-agents/reasoning": patch
---

A skill loaded with the `activate-skill` tool now publishes one `SkillActivated` bus event (`trigger: "model"`, the skill's version, the iteration it was recorded at), so `onSkillActivated` hooks from `.withReactiveIntelligence()` fire and dashboards can show which skills a run used. A duplicate or refused activation publishes nothing. An abstained run's `abstention.reason` now carries the whole reason; it was cut mid-word at 200 characters.
