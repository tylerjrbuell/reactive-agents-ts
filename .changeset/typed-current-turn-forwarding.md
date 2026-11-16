---
"@reactive-agents/reasoning": patch
---

`ReasoningService.execute` accepts an optional `currentTurnText` (the producer-typed current turn, no inlined history). It rides the run envelope, so every strategy's contract compile and `deriveConditions` read the typed turn instead of parsing history markers out of the task. Absent, behavior is unchanged.
