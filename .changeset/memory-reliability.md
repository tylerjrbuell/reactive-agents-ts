---
"@reactive-agents/memory": patch
"@reactive-agents/runtime": patch
---

Fix a default `dbPath` mismatch between memory and runtime that left core memory tables unindexed, and fix embedding/content/consolidation corruption caused by it. Screen memory writes for injection and PII before persisting, matching the guardrails already applied to LLM input.
