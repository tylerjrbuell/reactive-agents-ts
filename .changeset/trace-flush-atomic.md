---
"@reactive-agents/trace": patch
---

Trace files no longer contain every event twice when a run is aborted or two flushes overlap. `TraceRecorder.flush` now takes the pending batch atomically before writing and cannot be interrupted mid-write; events emitted during a write stay pending for the next flush instead of being dropped.
