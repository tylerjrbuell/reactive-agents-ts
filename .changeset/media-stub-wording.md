---
"@reactive-agents/core": patch
---

The inline-media stub now reads `[image omitted from record: ...]` (was `omitted from checkpoint`), since it also appears in run results and the stream. `redactInlineMedia` also accepts untyped lists.
