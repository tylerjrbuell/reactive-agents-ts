---
"@reactive-agents/channels": patch
"@reactive-agents/core": patch
---

`ChannelTurnAcknowledged` now carries an optional `ackFallbackReason` (`timeout`, `empty`, `thinking_only` or `error`) when a route asked for a model-written ack but the canned text was sent. A session's `acknowledge` port may return `{ text, fallbackReason }` as well as a plain string; plain-string resolvers keep working unchanged.
