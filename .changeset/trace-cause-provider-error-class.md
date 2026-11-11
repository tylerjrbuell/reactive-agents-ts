---
"@reactive-agents/trace": patch
---

`rax-diagnose cause` now names two more provider failures: `provider-error/malformed-output` (the provider rejected the model's own tool-call output, e.g. Ollama "XML syntax error" or Groq "Tool call validation failed") and `provider-error/token-rate-exceeded` (one request is larger than the per-minute token budget, e.g. Groq "Request too large ... tokens per minute"). The sub-cause comes from the structural error class first (`malformed_output`, `token_rate_exceeded` and the rest of the provider's closed set), then the error tag, then the error text. Older traces that tagged an XML parser failure as a rate limit, or a per-minute budget as a context overflow, are now read from the provider message instead. The evidence line says which source picked the sub-cause.
