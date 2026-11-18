---
"@reactive-agents/runtime": patch
---

`run-started.config.mechanisms` now records every resolved harness key, so a trace names every mechanism the run ran with. Added: `todoWrapUp` (`RA_TODO_WRAPUP=1`), `writeCoverage`, `toolIndexMaxEntries`, `disclosureMode`, `recencyBudgetChars`, `toolResultBudgetChars`, `treeOfThoughtExploreBudgetMs`, and `promptDumpPathPrefix` (presence only; the path is not recorded). A compile-time check and a drift test fail when the reasoning harness gains a key the record does not carry. No default changes.
