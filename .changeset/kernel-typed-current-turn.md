---
"@reactive-agents/reasoning": patch
---

The kernel input accepts an optional `currentTurnText`. When a producer supplies it (from `TaskMetadata.currentTurn`), the run contract and the derived post-conditions are built from that text instead of parsing history markers out of the task string. Without it, marker parsing runs as before, so behavior is unchanged.
