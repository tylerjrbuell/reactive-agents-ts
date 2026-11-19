---
"@reactive-agents/llm-provider": patch
---

Unknown hosted models no longer run on a 2048-token window. A model id with no static capability row on a hosted provider (Anthropic, OpenAI, Gemini, Groq, xAI) now resolves to a provisional 128,000-token window with native tool calling, instead of the local 2048-token fallback that dropped tools. The row keeps `source: "fallback"` (strict validation still flags it) and carries a new `provisional: true` field, which also appears in `describeCapabilityResolution` and the `capability-resolved` trace metadata. Groq and xAI keep their existing 131,072 window and are now flagged provisional too. LiteLLM gets no provisional window: a proxy often fronts a local model that truncates silently, so an unknown LiteLLM model keeps the conservative 2048-token fallback and its warning until `/model/info` reports its limits.

Capability discovery now covers Anthropic (`GET /v1/models/{id}`: input limit, output limit, vision, thinking) and LiteLLM (`/model/info`: input and output limits, vision, reasoning; the smallest limit wins when a model name has several deployments). OpenAI states no limits anywhere, so it relies on the provisional window.

When a provider rejects a request with a context-length or output-limit error that states the real limit (for example "maximum context length is 64000 tokens"), that limit is written to the model's capability, so the next resolve uses it. The mapped error carries it as `learnedLimit`, and `learnedCapabilityLimitFor(provider, model)` lists what was learned. Nothing is retried automatically. Static rows still win over discovered and learned values.

Concurrent discoveries of the same model now share one request.
