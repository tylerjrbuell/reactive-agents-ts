---
"@reactive-agents/reasoning": patch
---

A run that switches strategy now reports the tokens, cost and LLM calls spent before the switch. The switch rebuilt kernel state with zeroed spend, so switched runs under-reported usage (one measured run reported 11,195 tokens against 20,144 billed). The LLM-call cap also now applies across the whole run, as the iteration cap already did.
