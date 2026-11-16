---
"@reactive-agents/runtime": minor
---

Chat sessions have a mode, `"execute"` (default) or `"plan"`. Read it with `session.mode`, switch it with `session.setMode(mode)`, or start in one with `agent.session({ mode: "plan" })`. Every turn's run posture comes from the session mode, so plan mode runs each turn as pure reasoning (no tools) and the prose plan stays in the session history for the next execute turn. A per-turn `posture` option still overrides the mode for that turn. Session mode is separate from the `plan-execute` reasoning strategy. Without a mode set, behavior is unchanged.
