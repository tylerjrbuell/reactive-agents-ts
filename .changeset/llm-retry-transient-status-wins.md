---
"@reactive-agents/llm-provider": patch
---

Provider retries are classified by status first. A 5xx response, or a network fault with no status, is now retried even when its body mentions an API key, a missing model or a content filter. Before this fix, such a 503 failed at once with no retry. A 401 or 404 still fails at once. An error is retried only when its class is transient (rate limit, timeout, network, 5xx, malformed output), whatever its `retryable` flag says. Malformed model output (`LLMMalformedOutputError`) is now resampled with no backoff delay. The 3-retry cap is unchanged.
