---
"@reactive-agents/runtime": patch
---

Fixed — a paused run is no longer served back as a cached answer

The semantic cache could serve a paused run's sentinel content back to
`approveRun()` as if it were the completed answer. Paused runs are now
excluded from the cache-hit path.
