---
"@reactive-agents/reasoning": patch
---

Fixed — repetition guard no longer blocks legitimate multi-file work

`repetitionGuard`'s call ceiling on `file-write` used to trip on the 3rd call
regardless of target path, hard-stopping any task that needed to edit 3+
files with "Stop repeating this tool." It now passes calls whose target
argument (`path`/`file`/`target`/`url`/`id`) differs from every prior call to
the same tool, so legitimate multi-file work is never penalized while
same-target thrashing still hits the ceiling.
