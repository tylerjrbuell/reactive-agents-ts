---
"@reactive-agents/runtime": patch
---

`AgentResult.metadata.tokensUsed` and `cost` now count every LLM call the run made, from one source. Before, they added up what each reasoning pass reported about itself, which missed calls outside a pass's own count, so a plan-execute run could report about half of what it was billed (9,985 reported vs 18,639 billed in one ablation run). The run-scoped spend meter is now armed on every run, with or without `.withBudget()`, and the observable LLM wrapper feeds it on every call (kernel turns, planner, synthesis, classifier, quality gate, structured output). Budget limits still apply only with `.withBudget()`, and `runBudgetSpend` is still present only on budgeted runs. Delegated sub-agents now run with the same observable wrapper: a child's calls appear as `LLMRequestCompleted` events under the child's task id, and its spend folds into the parent's `tokensUsed` once. The post-answer debrief call stays outside the reported spend.
