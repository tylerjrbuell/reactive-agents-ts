---
"@reactive-agents/runtime": patch
---

The channel router's runtime resolver now implements `RoutedSession.reset` for per-conversation sessions. A route owner's `/new` or `/reset` flushes and clears the live session and empties the persisted chat history for that conversation, so the next message starts empty, even after a restart. A store failure maps to `RoutingError` (`turn_failed`) and the session is kept. `ChannelAgentHandle` gains the optional `clearSessionHistory`, supplied by `toChannelHandle`.
