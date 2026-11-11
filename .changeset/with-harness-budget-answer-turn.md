---
"@reactive-agents/runtime": patch
---

`.withHarness({ budgetAnswerTurn: true })` is now accepted, serialized by `toConfig()`/`fromConfig()`, and recorded in the `run-started` config as `mechanisms.budgetAnswerTurn`. Opt-in (default off, also `RA_BUDGET_ANSWER_TURN=1`): when the run holds validated tool evidence and only the answer is missing, the last think call the iteration budget allows ships with no tools so the model writes its answer.
