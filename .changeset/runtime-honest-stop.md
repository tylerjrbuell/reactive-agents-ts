---
"@reactive-agents/runtime": patch
---

A durable run stopped with `agent.stopRun()`, `handle.stop()` or `handle.terminate()` now returns an honest partial (`success: false`, `outcome: "partial"`, outstanding `stopped_by_request`) with the answer so far in `output`, instead of a success. The kernel writes its own checkpoint of the stopped state; the runtime's snapshot is only a fallback written when the kernel wrote none, so a stop leaves one final checkpoint. The stop record's `unfinished` items now come from the stopped kernel state for every stop kind.
