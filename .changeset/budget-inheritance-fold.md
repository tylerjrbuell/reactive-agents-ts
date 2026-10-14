---
"@reactive-agents/runtime": patch
---

Wave 5.4 budget inheritance pinned + fixed: a delegated child's LLM spend now folds into the PARENT's run-scoped budget meter (dynamic spawn-agent and local-agent-tools paths). Before this, child spend landed on neither the parent's meter nor its accumulator, so `.withBudget()` under-enforced on delegating runs (measured: parent meter 508 while the child added 224). `run-budget-arm.ts` header comment corrected to the real invariant (ONE meter per ROOT run — "sub-agents get their own" was comment-to-code drift). New `metadata.runBudgetSpend` ({ tokens, cost }) exposes the live meter total at terminal on budgeted runs (absent when un-budgeted), giving cost consumers the true run spend that `tokensUsed` (this agent's own calls) never carried.
