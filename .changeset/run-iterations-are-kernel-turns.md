---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

**`result.metadata.iterations` now counts the kernel's model turns.** It used to hold the reasoning step count, where every thought, action and observation counts. A run with 2 tool turns and an answer reported about 7 "iterations" instead of 3. The count now adds the turns of every reasoning pass of the run, including continuations and verification retries. A pass that ran no kernel (a custom `ReasoningService`) counts as 1. `stepsCount` is unchanged and still counts steps. It no longer falls back to the iteration count when a pass reported no steps; it is 0. `iterations` is now on the `AgentResultMetadata` type. The engine's trivial-run gates (memory flush, telemetry complexity) and the telemetry iteration count read the same turn count.

**`withMinIterations(n)` counts kernel turns.** The run must use at least `n` turns. Continuation passes run only until the run reaches `n` turns. Before, the floor always ran `n` continuation passes, however many turns the first pass used. A run whose first pass already used `n` turns now runs no continuation. To keep the old number of extra passes, raise `n` by the turns your first pass usually takes.

**A `.withHook()` hook fires once per phase occurrence.** Engine phases (`bootstrap`, `guardrail`, `cost-route`, `strategy-select`, `verify`, `memory-flush`, `cost-track`, `audit`, `complete`) fire once per run. Before, `bootstrap` fired twice, and `complete` `after` fired from the kernel before the engine's `complete` `before`. `act` and `observe` fire once per tool turn from the kernel. Kernel runs no longer get an extra `act` and `observe` fire after the kernel ends. Only a pass that ran no kernel still gets that single post-reasoning pair.
