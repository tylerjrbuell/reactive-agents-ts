---
"@reactive-agents/reasoning": patch
---

Template paths in a task (for example "write out-N.txt for each item", `{i}`, `<n>`) no longer compile into a literal deliverable, so runs that did the work are no longer failed for a file that can never exist.
