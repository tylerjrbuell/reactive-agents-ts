---
"@reactive-agents/reasoning": minor
---

A recoverable provider failure on a think turn no longer ends the run. When the stream fails, at start or mid-stream, the kernel retries the turn and picks the recovery from the provider's error class (`recoveryFor`):

- Malformed model output, such as Ollama's "XML syntax error on line 1: unexpected EOF", is resampled.
- An oversized request (context overflow, request too large, or an input tokens-per-minute budget) is compacted once per run and re-sent, sized to fit the budget.
- An output tokens-per-minute budget halves the turn's `max_tokens`.
- A rate limit, timeout, network fault or 5xx waits (the provider's retry-after, else 1s doubling, at most 10s) and re-sends.

The budget is 2 recoveries per run, and the same class is never retried three times in a row. Set it with `.withHarness({ llmRecoveryBudget })`, where `0` turns recovery off. Fatal classes (auth, exhausted quota, invalid request, ...) and a spent budget still end the run with `llm_error`. Each retry emits an `llm-recovery` harness signal with the iteration, error class, recovery and attempt. A failed attempt's partial output is discarded. When it had already streamed text, the signal sets `streamedTextVoid: true` so consumers can drop that text.
