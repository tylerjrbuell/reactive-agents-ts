---
"@reactive-agents/channels": minor
---

`SessionBridge` now honors a trigger's `lifecycle`: `conversation` sessions are torn down after their idle timeout (default 30 minutes), `ttl` sessions after `durationMs`, `single_response` sessions right after the reply with a fresh session id, and `persistent` or unset sessions are kept until evicted. The agent factory may return an optional `close()`, called on teardown, release and eviction. The session id stays stable across teardown, so a rebuilt agent resumes persisted history. New `SessionBridge.sweep()` and `idleTimeoutMs` / `now` options.

New `makeRouteMeter` and the `meter` option of `createChannelRouter`: a per-route message and cost meter. A turn that would pass the route's `maxCostPerDayUsd` is refused before the resolver runs and published as `ChannelTurnDropped` with reason `budget`; a message over `maxMessagesPerDay` drops with reason `rate`. `RouterStatus.dropped` gains a `budget` count.
