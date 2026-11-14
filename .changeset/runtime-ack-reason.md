---
"@reactive-agents/runtime": patch
---

`makeAcknowledge` now returns `{ text, fallbackReason? }` instead of a bare string, so the channel router can report why a model-written ack fell back to canned text (`empty`, `thinking_only`, `error`). The `onFallback` callback parameter is removed.
