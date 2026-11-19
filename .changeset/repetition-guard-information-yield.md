---
"@reactive-agents/reasoning": patch
---

The repetition guard now blocks a repeated tool only when it stops producing new information, not when its name has been seen a set number of times. Read-only query tools (for example `get_*`, `search`, `list_*` and MCP query tools) with distinct arguments keep running while their results keep changing; an agent analysing site metrics can query `umami/get_website_metrics` by url, referrer, country and browser without hitting "You have already called ... 4 times". The guard steps in when the tool's last 2 results were empty, failed or repeated earlier results (the nudge then says so), and a hard backstop stops distinct calls of one tool after `max(review point, ceil(maxIterations * 0.75))` calls (8 at the default 10 iterations; the review point is 4 for parallel-safe tools and 2 for others). A stalled requirement now only adds its "evidence is exhausted" note for the tool whose results it tracks.
