---
"@reactive-agents/tools": patch
"@reactive-agents/reasoning": patch
---

`discover-tools` now also loads the other tools the task needs. A query answer lists up to 4 extra task-relevant tools under "Also needed for this task (now callable)", ranked by the kernel's task-relevance scorer, so a task that needs two capabilities no longer depends on the model querying for each one. `recall` is no longer offered until a tool that can store a result has run, so models stop spending early turns on a recall that has nothing to return. Required tools are never hidden by these rules.
