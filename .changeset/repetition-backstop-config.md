---
"@reactive-agents/reasoning": patch
---

The repetition guard's hard backstop can now be configured with `HarnessConfig.repetitionBackstop`. The default is unchanged.

Past its review point, the repetition guard lets a tool keep running with new arguments while its results still add information. A backstop stops this at `max(review point, ceil(maxIterations * 0.75))` calls. `repetitionBackstop: { maxCalls?, iterationFraction? }` sets that cap. `maxCalls` is a call count: it is floored to a whole number of at least 0, and it wins over the fraction. `iterationFraction` is clamped to 0..1. Non-finite values are ignored. The review point is still the floor, so a lower cap never refuses a call the review point allows. The new `repetitionBackstopCalls(harness, maxIterations)` helper and `DEFAULT_REPETITION_BACKSTOP_FRACTION` are exported. Set it with `.withHarness({ repetitionBackstop })`.
