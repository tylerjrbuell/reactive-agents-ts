---
"@reactive-agents/reasoning": minor
---

The finish gate now holds a run to every file its task names, the same list the run contract shows. Before, the gate used a separate single-file guess: a task naming several files was held to one, and a task saying "save it to solution.ts" (no word "file") could be held to none, though the contract and the trust receipt listed them. Plan-execute sub-steps are exempt explicitly (`deliveryScope: "step"`), so a step is never held to the whole plan's files. A call such as `console.log(` in task text is no longer mistaken for a file name.
