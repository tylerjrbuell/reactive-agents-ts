---
"@reactive-agents/cortex": patch
---

The Lab builder's **Plan budget** switch now shows off by default, matching the framework, where `planBudget` is opt-in. Cortex writes the `planBudget` key into the harness config only when you flip the switch; an untouched config sends nothing.
