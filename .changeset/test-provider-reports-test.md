---
"@reactive-agents/llm-provider": patch
---

The test provider now reports `provider: "test"` from `getModelConfig()` instead of `"anthropic"`, so LLM telemetry (`LLMRequestCompleted`, cost, model pages) no longer attributes test-provider calls to Anthropic. `ModelConfig.provider` accepts `"test"` alongside the `LLMProviderType` names.
