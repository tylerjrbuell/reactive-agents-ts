---
"@reactive-agents/reasoning": patch
---

blueprint stops before running any plan step when planning already used up the token budget, like plan-execute does. Before, it still executed every tool step (including side-effecting ones) and could report `completed` over budget. The run now ends as a partial whose output lists the planned steps that did not run.
