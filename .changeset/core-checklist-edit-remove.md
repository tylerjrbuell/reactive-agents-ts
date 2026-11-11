---
"@reactive-agents/core": minor
---

`ChecklistItemOp` gains two ops: `{ op: "edit", id, title }` replaces an advisory item's title (status kept, not a status mark), and `{ op: "remove", ids }` deletes items. `foldAdvisory` and `inferChecklistProgress` now switch on `op` exhaustively, so a new op can no longer be misread as a status change. Ops naming an unknown or removed id are no-ops; a removed id added again starts as a fresh pending item with no inherited marks. Code that narrows on `change.op` should handle the two new members.
