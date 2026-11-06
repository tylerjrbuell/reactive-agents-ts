---
"@reactive-agents/reasoning": patch
---

Deliverable derivation no longer turns a task's input file into a write requirement. A path named as the source of the data ("every row from the batches pipeline.json lists") now counts as an input, the same as a path after a read verb, so the run contract stops telling the model to "produce" (and overwrite) its own input. Absolute deliverable paths also stay absolute in the contract: `/tmp/out/report.md` is no longer rendered as `.//tmp/out/report.md`.
