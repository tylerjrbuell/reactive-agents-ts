---
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/reasoning": patch
---

The reactive-intelligence early stop near the iteration cap no longer ends a run that is still producing evidence. It used to decide "spinning" from the entropy shape alone, which stopped runs at iteration 13 of 14 while they were writing a new file each pass. The kernel now passes `progressedThisPass` (the latest run assessment's `evidenceDelta > 0`) to the controller on every path; the hard `max_iterations` stop is unchanged.
