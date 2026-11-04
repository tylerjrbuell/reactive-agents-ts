---
"@reactive-agents/reasoning": patch
---

The terminal gate now checks every file the task names, not only the first. A run that writes 2 of 3 named files is refused with guidance naming the missing file; if it still ends, the outcome names it. Deliverables carry a typed `source` (`task-explicit` today) through one builder.
