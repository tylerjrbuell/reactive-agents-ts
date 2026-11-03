---
"@reactive-agents/cortex": patch
---

Cortex utility prompts (chat titles, compaction summaries, goal rubric checks) now run the one-turn `direct` strategy capped at one iteration instead of a full reactive run.
