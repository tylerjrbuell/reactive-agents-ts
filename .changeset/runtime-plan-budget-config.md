---
"@reactive-agents/runtime": patch
---

`planBudget` is a first-class harness key (`.withHarness({ planBudget })`, default on, `RA_PLAN_BUDGET=0` off). `planBudget` and `wrapUpReserve` are recorded in the run-started mechanism config so runs replay and diagnose with the budget they ran under.
