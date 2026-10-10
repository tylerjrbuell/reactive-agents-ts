---
"@reactive-agents/llm-provider": patch
---

Apply the Ollama per-call timeout while the streaming request is being set up,
including the wait for the first response chunk. The timeout now aborts the
underlying SDK fetch instead of leaving a cold or stalled request unbounded.
