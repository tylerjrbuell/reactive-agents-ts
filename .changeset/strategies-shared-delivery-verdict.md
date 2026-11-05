---
"@reactive-agents/reasoning": minor
---

Blueprint and code-action runs are now held to the files their task names, through the same shared delivery check as plan-execute and the main loop. Their results carry a real verdict (it was `null`): accepted when every named file exists or none was asked for, refused (status `partial`) when one is missing. Reflexion's own delivery check now judges the same run contract as every other strategy instead of deriving its own conditions, so all strategies agree on what a task asked for.
