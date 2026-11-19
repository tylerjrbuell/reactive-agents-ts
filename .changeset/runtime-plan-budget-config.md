---
"@reactive-agents/runtime": patch
---

`planBudget` is a first-class harness key and is **off by default**. Turn it on with `.withHarness({ planBudget: true })` or `RA_PLAN_BUDGET=1`; explicit config beats the env. It ships opt-in because the 2026-11-16 plan-posture ablation measured +15-36% tokens with no accuracy lift. `planBudget` and `wrapUpReserve` are recorded in the run-started mechanism config so runs replay and diagnose with the budget they ran under.
