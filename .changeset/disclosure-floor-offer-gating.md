---
"@reactive-agents/reasoning": patch
---

Tool disclosure follows two new rules over the run's permitted tools. First, if pruning would leave no domain tool while some tool is permitted, the model is offered the required tools, the tools the task names, and the top 5 keyword matches. It never gets a tool the run did not permit. Second, `discover-tools` is offered only while a permitted tool is still hidden. Runs where every permitted tool is already offered no longer carry a `discover-tools` schema that could only answer "nothing new".
