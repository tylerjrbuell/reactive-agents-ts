---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`agent.channelStatus()` returns the channel service snapshot (adapters, sessions, message counters; `null` before the gateway starts), and `agent.gatewayStatus().inboundQueue` reports the inbound queue's `ready`, `deferred`, `capacity`, `overflow` and a live `dropped` count. Also fixes `.withGateway()` options (`queue`, `port`, `webhooks`, `accessControl.mode`/`sessionTtlDays`) never reaching the running gateway; they silently fell back to defaults.
