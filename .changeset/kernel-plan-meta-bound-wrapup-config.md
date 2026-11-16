---
"@reactive-agents/reasoning": patch
---

`ReasoningIterationProgress.maxIterations` now reports the effective iteration bound on seeded plan runs: the plan-sized budget raise and each bookkeeping refund update the run's recorded bound, so progress no longer shows a configured limit the run already passed. `HarnessConfig.wrapUpReserve` (config beats `RA_WRAPUP_RESERVE`, default off) is now a typed harness key. Plan-step tool hints are parsed by the shared core `planStepToolHint`. The reasoning execute request declares `builtinFloorTools` and `allowedTools`.
