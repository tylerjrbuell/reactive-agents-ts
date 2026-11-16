---
"@reactive-agents/tools": patch
---

`todo add` duplicate detection now uses core's shared `isNearDuplicateTitle` rule. Titles dedupe at 80% overlap of the larger title (was Jaccard), any 2+ token title contained in a larger one dedupes (was 3+ existing tokens), and `of`, `to`, `and` join `the`/`a`/`an` as ignored words.
