---
"@reactive-agents/runtime": patch
---

`.withHarness({ repetitionBackstop: { maxCalls?, iterationFraction? } })` now sets the repetition guard's hard backstop. The field survives `toConfig()`, JSON and `fromConfig()`. Each run records the backstop it used in `run-started.config.mechanisms.repetitionBackstop`. When you do not set it, the record is `{ iterationFraction: 0.75 }` (the unchanged default).
