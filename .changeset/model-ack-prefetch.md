---
"@reactive-agents/channels": patch
---

Model-written acks (`ack.source: "model"`) now start the session's `acknowledge` port call when the turn starts instead of at `afterMs`. At `afterMs` the router uses the result if ready, else waits up to `modelTimeoutMs` from `afterMs`, else falls back to canned (`timeout`). A cold thinking model no longer times out most turns. The call is interrupted with the turn.
