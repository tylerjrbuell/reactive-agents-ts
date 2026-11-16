---
"@reactive-agents/cortex": patch
---

Cortex shows the plan-sized iteration budget: the feed lists "iteration budget raised to N for the plan" and the loop readouts divide by the raised bound instead of the configured one. A plan step with no stored tool takes the hint its text names (the core helper), so model-written steps no longer show an empty tool dropdown, and a saved plan's tool choices resolve through the core `tool` checklist op.
