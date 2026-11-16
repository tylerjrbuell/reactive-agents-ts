---
"@reactive-agents/runtime": patch
---

`agent.session().setMode()` now publishes a `ChatModeChanged` event (`{ sessionId, from, to, timestamp }`) on the agent's EventBus, once per actual change. Setting the mode the session already has publishes nothing.
