---
"@reactive-agents/runtime": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/tools": minor
---

Wave 5 delegation composition + strategy-tier honesty. A delegated child's
completion envelope now crosses back on its result (executors derive it from
the engine result's honesty markers) and the parent terminal joins children
worst-of: a partial child caps a completed parent claim instead of laundering
it into a success. plan-execute per-step budgets derive from the run's own
iteration budget (floor 5) instead of the literal 3; code-action documents its
kernel-less reliability posture (terminal-mint guarantees, no mid-run repair).
