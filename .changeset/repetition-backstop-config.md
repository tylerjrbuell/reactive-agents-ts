---
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

The repetition guard's hard backstop can now be configured with `.withHarness({ repetitionBackstop: { maxCalls?, iterationFraction? } })` (`HarnessConfig.repetitionBackstop`). The default is unchanged.

Past its review point, the repetition guard lets a tool keep running with new arguments while its results still add information. The backstop caps that run:
- `iterationFraction` (default 0.75, clamped to 0..1) allows `ceil(maxIterations * fraction)` iterations' worth of calls. One iteration counts as `maxBatchSize` calls for a parallel-safe tool and 1 call otherwise.
- `maxCalls` is a plain call count. It is floored to a whole number of at least 0 and wins over the fraction.
- Non-finite values are ignored.
- The review point is still the floor, so a lower cap never refuses a call the review point allows.

The field survives `toConfig()`, JSON and `fromConfig()`. Each run records the backstop it used in `run-started.config.mechanisms.repetitionBackstop`, which is `{ iterationFraction: 0.75 }` when unset. `repetitionBackstopCalls()` and `DEFAULT_REPETITION_BACKSTOP_FRACTION` are exported from `@reactive-agents/reasoning`.
