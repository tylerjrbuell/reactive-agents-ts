---
"@reactive-agents/reasoning": minor
---

A run seeded with a plan checklist now gets an iteration budget sized from the plan. When the unchecked steps plus a reserve (the larger of 2 and 25%) need more iterations than `maxIterations`, the bound is raised once at run start, to at most the smaller of 60 and 3x the configured value. The raise is recorded as a `plan-budget` harness signal and a `plan_budget_raised` event carrying `{configured, steps, effective, hardCap}`. The todo-only refund keeps its cap on the configured budget, and the raise plus refunds never pass the hard cap. Unseeded runs and plans that fit are unchanged, and cost, token and time limits still end the run. Opt out with `harness: { planBudget: false }` or `RA_PLAN_BUDGET=0`.
