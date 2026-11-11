---
"@reactive-agents/llm-provider": patch
---

Provider failures caused by malformed model output now fail with a new tagged error, `LLMMalformedOutputError` (`errorClass: "malformed_output"`, `retryable: true`). They used to read as a `network` fault on `LLMRateLimitError`, or as a permanent `LLMError`. This covers Ollama's tool-call parser ("XML syntax error on line 1: unexpected EOF", "error parsing tool call") and Groq's "Tool call validation failed" / `tool_use_failed`. The provider retry schedule resamples them, on a stream only before the first emitted event. `LLMErrors` now includes `LLMMalformedOutputError`: an exhaustive `switch` on `_tag` needs a new case.

The provider retry schedule now keys on an error's `retryable` flag (exported as `isRetryableLLMError`) instead of on its tag. Two visible changes follow. A 429 for an exhausted quota (`insufficient_quota`) is no longer retried. A provider timeout reported only in the error message ("Request timed out.") is now retried.

"Request too large ... tokens per minute (TPM/ITPM/OTPM)" is now its own class, `token_rate_exceeded`. A hard 413 body limit stays `request_too_large`, and "Rate limit reached ... Used N" stays `rate_limit`. Input-side TPM/ITPM still maps to `LLMContextOverflowError`, now with `tokenCount` = Requested and `maxTokens` = Limit. Output-side OTPM maps to `LLMError`, because a smaller prompt does not fix it (lower `max_tokens`). A 429 "Request too large" on a per-minute budget is no longer retried, since the request alone exceeds the budget.

New export: `recoveryFor(errorClass, retryable?)` returns `"resample" | "shrink" | "backoff" | "fatal"` (type `LLMRecovery`).
