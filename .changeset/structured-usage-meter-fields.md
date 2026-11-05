---
"@reactive-agents/reasoning": patch
---

Structured-output LLM calls (planners, classifiers) now report their token usage on `LLMRequestCompleted` instead of 0, and the run spend meter also tracks input tokens, output tokens and LLM-call count for every call.
