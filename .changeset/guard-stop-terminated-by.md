---
"@reactive-agents/core": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
---

New `terminatedBy` value `"guard_stop"`: a failed run stopped by a harness guard (loop detection, stall, low progress, oracle force, strategy-switch exhaustion) before the iteration cap now reports `guard_stop` instead of `max_iterations`, which wrongly suggested raising `maxIterations`. Behavior is otherwise unchanged: `goalAchieved` is `false`, the run outcome is `partial`, and a bare builder still throws, exactly as for `max_iterations`. True cap and budget exits keep `max_iterations`. If you switch exhaustively on `TerminatedBy`, add the new case.
