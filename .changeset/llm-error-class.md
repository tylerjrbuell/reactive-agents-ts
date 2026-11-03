---
"@reactive-agents/llm-provider": patch
---

Provider failures now carry a typed classification: `LLMError`, `LLMRateLimitError` and `LLMContextOverflowError` gain optional `errorClass` (`rate_limit | context_overflow | request_too_large | invalid_param | tool_schema_invalid | auth | model_not_found | timeout | network | provider_5xx | content_filter | unknown`), `retryable` and `status`, set at the single provider error-mapping choke point (`classifyProviderError` is exported). Context-overflow and request-too-large failures (400/413 shapes) are now returned as `LLMContextOverflowError` (previously a generic `LLMError`); they are still not retried. Classification only — no retry or recovery behavior changed.
