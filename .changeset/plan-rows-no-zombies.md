---
"@reactive-agents/reasoning": patch
---

Planning strategies no longer leave zombie or duplicate checklist rows: rows of replaced non-completed plan steps are removed, patch and augment steps are deduped against existing titles (augment capped at 3), and a step's tool hint is written to its row.
