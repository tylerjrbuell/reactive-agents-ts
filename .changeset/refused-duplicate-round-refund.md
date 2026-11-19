---
"@reactive-agents/reasoning": patch
---

A round in which every tool call was refused as a duplicate no longer spends an iteration of the budget. The loop bound is raised by one for it, the same bounded refund the todo-only round gets (one shared cap of half the original budget), and at most 3 such rounds in a row: only a call that ran resets the count, so an endless re-read loop still spends the budget after 3 free turns. Switch: `harness.bookkeepingRefund: false`.
