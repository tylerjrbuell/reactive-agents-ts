---
"@reactive-agents/channels": patch
---

The routing engine now sets `ackLatencyMs` on `ChannelTurnAcknowledged` when a model-written ack was attempted: the time from the model call's start to its result, or to the timeout bound when it timed out. Narration and canned-only acks omit it.
