---
"@reactive-agents/cortex": patch
---

Cortex exposes the framework's tool disclosure setting. The chat `/tools` picker gains "Show tools: all / index / discover / tier default" rows (`.withTools({ disclosure })`), the run view shows the resolved disclosure mode and the layer that decided it, and the Lab `tools.builtins` field suggests the framework's toolset names (now including `read`) instead of a hand-copied list.
