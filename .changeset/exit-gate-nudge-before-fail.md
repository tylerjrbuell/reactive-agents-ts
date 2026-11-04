---
"@reactive-agents/reasoning": patch
---

A soft harness guard (loop detection, stall) that fires before the model has written any answer now gets one "write the final answer" nudge instead of failing the run immediately. The guard's failure stands only if it fires again, at the iteration cap, or when no iteration is left. A run with nothing to work from still never gets a synthesized answer.
