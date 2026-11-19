---
"@reactive-agents/tools": patch
---

`recall` advertises its segmented-read parameters again (`start`, `maxChars`, `lineStart`, `lineCount`, `arrayStart`, `arrayCount`). Tool input validation keeps only advertised parameters, so these were dropped before reaching the handler, and the segmented-recall hints in compressed tool results (for example `recall("k", start: 0, maxChars: 1200)`) did nothing. Section reads now work end-to-end.
