---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

Session turns accept per-turn skill pins. `session.chat(message, { skills: { activate } })` and `session.runStream(message, { skills: { activate } })` now forward the pins to the turn's run, the same way `run()` and `runStream()` already did, so a host can load a skill for one chat turn without rebuilding the agent. `ChatOptions` gains the `skills` field.
