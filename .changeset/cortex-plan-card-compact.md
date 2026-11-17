---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

Cortex: the chat plan card is compact (one line per step, a quiet "+ tool", and a dependencies/args chip that opens its editor in place), a turn you paused reads "paused by you" instead of "stopped by you", and an iteration-cap stop says "iteration limit" instead of "spending limit". ui-core adds `UserInterrupt`, `userInterruptOf` and `TurnOutcome.userInterrupt` (additive).
