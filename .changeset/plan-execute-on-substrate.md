---
"@reactive-agents/reasoning": patch
---

The plan-execute-reflect strategy now runs on the shared strategy run substrate, like direct, reactive, tree-of-thought and reflexion. One run ledger collects its direct tool calls, its plan checklist and every step kernel's own ledger. Before, each step's ledger was rebuilt from its steps. One spend meter counts every model call. Reported `llmCalls` is now complete: the single-analysis generation and the rationale retry were previously not counted. Tool evidence from composite steps now appears in the result's steps. Abstention, budget stops and approval pauses end the run through the same terminal as the other strategies. A grounded abstention, a budget stop and a paused approval produce the same results as before.
