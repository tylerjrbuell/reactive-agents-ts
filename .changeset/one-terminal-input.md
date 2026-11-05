---
"@reactive-agents/reasoning": minor
---

The strategy terminal takes one typed input whose facts are required. `FinalizeExtras` is removed from the public exports. Custom strategies that call `finalizeStrategyResult` directly must now pass `taskId`, `requiredTools` (use `[]` to defer to the task contract), `runLedger` (use `[]` when no tool ran) and `repairCapabilities` (`{ perIteration: true }` for a kernel-backed strategy). A strategy's own delivery decision is passed as `delivery: { runContract, decision }`, so a decision can never be read without its contract.
