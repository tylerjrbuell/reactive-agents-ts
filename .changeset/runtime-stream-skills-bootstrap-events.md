---
"@reactive-agents/runtime": minor
---

`runStream(task, { skills: { activate } })` pins skills for that turn, the same as `run()`.

Skills injected at bootstrap (builder pins, run pins and task-relevant picks) now publish one `SkillActivated` event each per run, with `trigger: "bootstrap"`, the run's `taskId` and the skill body's `sha256` (the same hash `run-started.config.skills` records). `onSkillActivated` from `.withReactiveIntelligence()` fires for them. Before, only skills the model loaded with `activate-skill` produced the event.
