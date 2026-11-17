---
"@reactive-agents/reasoning": patch
---

The plan-sized iteration budget is now staged. A plan-seeded run starts with half of the raise (for example 17 of a 23-iteration target at `maxIterations` 10) and gets the rest only when it made progress since the raise: a checklist row completed or a tool step succeeded. A run that stalls ends at the first stage instead of spending the full extra budget. The `plan_budget_raised` guard event now carries `stage`, and the second stage records its own `plan-budget` signal. The default (on) and the `planBudget` key are unchanged.
