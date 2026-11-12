---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

`.withChannels({ adapters })` now accepts the canonical `ChannelAdapter` (typed delivery receipts, backpressured inbound stream, no connect/disconnect) as well as the legacy `MessageChannel`. Stopping the gateway calls `ChannelService.shutdown()`, which closes canonical adapters; legacy adapters are still disconnected.
