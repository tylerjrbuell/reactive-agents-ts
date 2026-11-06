---
"@reactive-agents/llm-provider": patch
---

Ollama `completeStructured()` now defaults thinking off. When neither `request.thinking` nor `LLMConfig.thinking` is set, thinking-capable models (qwen3 family) get `think: false` and `num_predict` equals the caller's `maxTokens`. Before this change, no `think` param was sent and the cap was widened by the 6,000-token thinking allowance. In an H3 recheck, qwen3:4b planner calls emitted up to 13,855 tokens for a plan JSON of about 200-500 tokens. This matches the cloud providers, whose structured paths reserve thinking only on explicit opt-in. To keep thinking, set `thinking: true` on the request or in the config: you get `think: true` plus the allowance, as with `complete()`. A debug log, `structured-thinking-suppressed`, fires when the default turns thinking off. Non-thinking models are unaffected. The thinking helpers moved from `providers/local.ts` to `providers/ollama-thinking.ts`, and `local.ts` still re-exports them.
