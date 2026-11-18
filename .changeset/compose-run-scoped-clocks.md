---
"@reactive-agents/compose": patch
---

`timeoutAfter()` now measures the whole run. Before, its clock restarted at every kernel pass, so a run with continuation passes (`withMinIterations`, verification retry, plan-execute steps) could run past its timeout. Once it had fired, it also fired on the first turn of every later run on the same agent. Each run now gets its own clock, started at the run's first kernel pass.

`watchdog()` now starts its no-progress clock when a kernel pass starts. Before, the clock ran from when the agent was built or from the previous run's last turn. A run started after an idle gap longer than `noProgressFor` was aborted on its first turn.
