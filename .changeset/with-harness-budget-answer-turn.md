---
"@reactive-agents/runtime": patch
---

`.withHarness({ budgetAnswerTurn })` is now accepted, serialized by `toConfig()`/`fromConfig()`, and recorded in the `run-started` config as `mechanisms.budgetAnswerTurn`. Default on: when the run holds validated tool evidence and only the answer is missing, the last think call the iteration budget allows ships with no tools so the model writes its answer. Opt out with `.withHarness({ budgetAnswerTurn: false })` or `RA_BUDGET_ANSWER_TURN=0`.
