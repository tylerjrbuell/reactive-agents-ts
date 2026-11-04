---
"@reactive-agents/reasoning": minor
---

Plan-execute now recovers once when its plan declares the goal met but a file the task names was never written. The harness adds the missing deliverables to the refinement prompt and runs one more plan pass. If the file is still missing, the run ends `partial` and its answer ends with a harness-written `Unfinished:` list naming what is outstanding. The decision is traced as guard `strategy_delivery_gate` (`block` on the repair, `terminate` on the handoff).
