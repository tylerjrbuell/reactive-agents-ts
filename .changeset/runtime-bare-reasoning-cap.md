---
"@reactive-agents/runtime": patch
---

`.withReasoning().withMaxIterations(5)` now keeps the cap of 5. A bare `.withReasoning()` (no options) used to hand the strategy an unmarked default of 10, so the explicit cap was lost and the `max_iterations_clamped` warning printed the wrong value.
