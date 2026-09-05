---
"@reactive-agents/llm-provider": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/observe": patch
"@reactive-agents/core": patch
"@reactive-agents/runtime": patch
"@reactive-agents/benchmarks": patch
---

Fix `LLMRequestCompleted` never having a producer, which silently starved nine downstream consumers (OTel LLM spans, cost accounting, cache-hit reporting). Surface `cacheReadInputTokens` in Gemini, OpenAI, and LiteLLM usage (previously Anthropic-only), switch Anthropic to automatic prompt caching, and correct Haiku's documented prompt-cache minimum (2048 → 4096). Billed tokens and cache reads now carry through to `result` and the benchmark cost/ablation gate, instead of silently reporting 0 when the event never fired.
