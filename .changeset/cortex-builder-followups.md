---
"@reactive-agents/cortex": patch
---

Cortex builder follow-ups. `POST /api/runs` now validates the loosely-typed body fields before launch: malformed `agentTools` entries and nameless `variables` are dropped, and `modelRouting.tierModels` keeps only the `haiku`/`sonnet`/`opus` keys (previously the body was forwarded untyped). A durable store `dir` in a saved or chat config is no longer silently dropped. The docs page now covers the chat quick bar and the Lab shell, workspace, guardrail and approval-mode controls, and notes that a chat turn paused by an approval-gated tool cannot yet be approved from Cortex.
