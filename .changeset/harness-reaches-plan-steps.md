---
"@reactive-agents/reasoning": patch
---

`.withHarness()` settings now apply inside plan-execute step kernels. Each step's ReAct pass used to resolve the harness from environment variables and defaults only, so harness switches set on the builder were silently ignored inside plan steps. An explicit per-step harness still wins.
