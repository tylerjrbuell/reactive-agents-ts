---
"@reactive-agents/llm-provider": patch
---

Ollama `stream()` now honors `maxTokens` as a hard output cap for thinking models. The stream path used to add a 6,000-token thinking allowance to `num_predict`, so qwen3:4b could stream 13,200 tokens against `maxTokens: 7200`. Ollama counts thinking tokens against `num_predict`, so the stream now stops at the requested cap, and a turn that spends the budget thinking ends with `stopReason: "max_tokens"`. `complete()` and structured output keep the allowance.
