---
"@reactive-agents/runtime": patch
---

Gateway lifecycle fixes. `handle.stop()` called while the gateway is still starting up now tears down everything startup acquires (heartbeat interval, channel subscription, router host, ingress port); before, startup finished after `stop()` and left the interval running and the port bound. A gateway configured with `withChannels({ routes })` whose router fails to start now stops and resolves `done` with a summary `error` (previously it logged once and kept running with no inbound channels). A rejecting route session `end()` no longer aborts router shutdown. The router host rejects with the tagged `RoutingError` rather than a `FiberFailure`. The legacy channel subscriber no longer drops a user's identical repeat message (dedup now keys on sender, platform timestamp and text, expires by clock, and schedules no per-message timer). A non-string webhook `metadata.instruction` is ignored instead of cast.
