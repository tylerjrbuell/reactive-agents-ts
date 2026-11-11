---
"@reactive-agents/llm-provider": patch
---

Export `isRetryableLLMError` from `@reactive-agents/llm-provider`. It is the predicate the provider retry schedule uses to decide whether to re-send a failed request. Import it to learn whether the provider already retried an error, instead of keeping a copy. Retry behavior does not change.
