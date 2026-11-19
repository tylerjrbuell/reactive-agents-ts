---
"@reactive-agents/reasoning": patch
---

A kernel pass that stops on its own iteration cap now runs the tool calls of its last think when the run still has iteration budget, instead of silently dropping them. Multi-pass strategies (reflexion's generate and improve passes, direct) used to lose their final, often most useful, batch: the cap counts think calls, so the act after the last think never ran (a reflexion improve pass dropped 4 web searches with 3 of the run's 10 iterations left). The batch runs once through the normal act path (guards, approval, repetition, result recording) and adds no LLM call. When the run's own budget is spent the batch is still dropped, and the `pending_batch` record now says why (`cause: "run-budget-exhausted"`).
