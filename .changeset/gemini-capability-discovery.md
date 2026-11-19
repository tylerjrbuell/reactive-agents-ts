---
"@reactive-agents/llm-provider": patch
---

Unknown Gemini models now resolve to their real limits. A Gemini model id that is not in the static capability table (for example `gemini-4-carbon`) previously fell back to a 2048-token window with thinking off. The build step now asks the Gemini API's `models.get` once per model and process, and uses the reported input limit, output limit and thinking support. Gemma ids still have thinking off. If the request fails or no API key is set, the model keeps the conservative fallback and its one-time warning.

Discovery is a general per-provider hook: `registerCapabilityDiscoverer(provider, discoverer)` installs one, and Ollama's `/api/show` probe now runs through the same hook. Static table rows still win over discovered values. Added static rows for `gemini-4-carbon` and `gemini-4-argon` (1,048,576 input / 32,768 output tokens, thinking on, per `models.get` on 2026-11-19).
