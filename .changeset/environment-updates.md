---
"@reactive-agents/runtime": minor
"@reactive-agents/core": minor
"@reactive-agents/trace": minor
---

Chat sessions can tell the model what changed in its environment between turns (model, thinking, tools, skills, docs, goal, agent-control, user to-do edits). `session()` accepts `environment`, `publishEnvironment`, `initialEnvironment` and `environmentUpdates`; a change publishes one core `EnvironmentChanged` event, mapped to a new `environment-updated` trace event. The notice is attached only on turns where something changed; unchanged turns send identical requests. `environmentUpdates: false` disables it. Cortex chat wires it by default (session config key `environmentUpdates`). Informational only; no answer-quality improvement is claimed.
