---
"@reactive-agents/core": patch
---

`isNearDuplicateTitle` no longer treats two titles as duplicates when both carry digit-bearing tokens and those tokens differ (`out-1.txt` vs `out-2.txt`, `Step 1` vs `Step 2`, `Q3` vs `Q4`). Per-item numbered steps are distinct work and are no longer collapsed by `todo add` or plan refinement.
