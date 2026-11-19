---
"@reactive-agents/reasoning": patch
---

plan-execute (and blueprint's remainder) step kernels now carry the run's iteration budget, like direct and reflexion passes. A step with a small iteration cap no longer blocks the 4th distinct call of one tool through the repetition backstop, and the tool calls a step proposes on its last allowed turn now run while the run still has budget instead of being dropped.
