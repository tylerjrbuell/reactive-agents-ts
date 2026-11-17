---
"@reactive-agents/reasoning": patch
---

The todo wrap-up turn is now opt-in. Before, when the model's final answer would be accepted while todo rows it had opened were still open, the harness always held the answer for one extra model turn to reconcile them. That turn costs a model call and has not been measured by an ablation, so it is now off by default. Set `RA_TODO_WRAPUP=1` to turn it on.
