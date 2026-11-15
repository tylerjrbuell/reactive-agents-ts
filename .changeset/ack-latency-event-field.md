---
"@reactive-agents/core": patch
---

`ChannelTurnAcknowledged` gains an optional `ackLatencyMs`: milliseconds from the model-ack call start to the port result or timeout. Absent when no model ack was attempted.
