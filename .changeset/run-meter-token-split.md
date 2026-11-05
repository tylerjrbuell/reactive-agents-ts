---
"@reactive-agents/runtime": patch
---

`AgentResult.metadata.inputTokens`, `outputTokens` and `llmCalls` now come from the run spend meter, the same source as `tokensUsed` and `cost`. They count every LLM call in the run (planner, synthesis, classifier, quality gate, structured output) and include a delegated sub-agent's calls exactly once. When the provider reports the prompt/completion split, `inputTokens + outputTokens === tokensUsed`. A provider that reports totals only keeps the strategy's own split. `metadata.runBudgetSpend` on budgeted runs also carries `inputTokens`, `outputTokens` and `llmCalls`.
