---
"@reactive-agents/llm-provider": minor
---

Added — dynamic OpenAI-compatible provider config (#198)

- `.withProvider(provider, { baseUrl, apiKey, headers })` now accepts a
  runtime endpoint override for the whole OpenAI-compatible provider family —
  `openai`, `groq`, `xai`, and `litellm` all speak the same Chat Completions
  wire protocol. Point any of them at a llama.cpp server's `/v1` API,
  Deepseek, a LiteLLM proxy on a non-default host, or any other
  OpenAI-compatible endpoint at runtime, without predefining
  `LITELLM_BASE_URL`/`OPENAI_API_KEY`/etc as env vars.
- Custom headers now flow through: the raw-fetch header merge `litellm`
  already had, and the openai-node SDK's `defaultHeaders` option for
  `openai`/`groq`/`xai`.
- An inline `apiKey` supplied this way now also satisfies
  `.withStrictValidation()`'s missing-key check — previously it only read the
  provider's env var, so a fully-configured custom endpoint with no matching
  env var incorrectly failed strict validation.
- Not propagated to `.withFallbacks()`-configured fallback providers — a
  fallback is a different provider/endpoint by definition.
