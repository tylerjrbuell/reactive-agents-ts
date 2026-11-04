---
"@reactive-agents/reasoning": patch
---

Plan-execute and blueprint analysis steps now see the full data earlier tool steps returned, not the compressed preview. Before, a step asked to summarize a 46-row file saw 3 rows plus "...43 more lines" and wrote its report from those. Prior results stay whole newest-first within the same recency budget the kernel uses for its latest tool result (about 35% of the context window); older results beyond it keep their preview.
