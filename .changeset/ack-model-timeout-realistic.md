---
"@reactive-agents/channels": patch
---

Model-written acks wait up to 12 s (was 3 s) after `afterMs` for the `acknowledge` port before falling back to the canned text; a cold model queued behind the turn's own calls no longer loses to the fallback. `ack.modelTimeoutMs` now accepts 1 to 30 000.
