---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": minor
---

The reactive (and react) strategy card now shows the ReAct loop: one block per iteration with the model's thought, each tool action with compact arguments, and a one-line observation (failures marked), live while the turn runs with the current iteration highlighted, collapsing to "N iterations, M tools" when it ends. ui-core adds `reactLoopOf`, `reactLoopChip` and `compactArgs`, pure and derived from a turn's per-iteration text and tool calls, so a builder's own chat UI can draw the same view.
