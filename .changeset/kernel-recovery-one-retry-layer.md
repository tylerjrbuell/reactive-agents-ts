---
"@reactive-agents/reasoning": patch
---

Think-turn LLM recovery no longer stacks on the provider's retries. A retryable failure (rate limit, timeout, 5xx, network, malformed output) raised before the stream's first event has already been re-sent 3 times by the provider's retry schedule, so the kernel no longer backs off and re-sends it again: the turn ends with `llm_error` and an `llm-recovery` block signal with reason `provider-retried`. Before, one think turn could make about 12 calls and wait about 40 seconds. Failures after the stream emitted, init failures and request-shrinking recoveries still recover in the kernel as before. A prompt compaction retry now keeps the lower `max_tokens` an earlier output-side (OTPM) retry in the same turn set, so it no longer hits the same limit again.
