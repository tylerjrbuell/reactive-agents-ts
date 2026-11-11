---
"@reactive-agents/reasoning": patch
---

A run stopped by `.withBudget({ tokenLimit | costLimit })` (`terminatedBy: "budget_exceeded"`) now publishes `BudgetExhausted` with the budget kind (`"tokens"` or `"cost"`), the limit and the amount used, before the terminal event. Before, only the `budgetLimit()` killswitch published it, so a builder budget stop showed up only as `terminatedBy` on the terminal event. One event is published per exhausted budget.
