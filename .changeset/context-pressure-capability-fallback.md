---
"@reactive-agents/reasoning": patch
---

ContextPressure is now emitted for hosted providers (OpenAI, Anthropic, Gemini, ...). When the provider does not report a resolved context window, the framework capability row for the model supplies it, but only when a real row exists (never the conservative fallback window). Ollama's provider-set window is unchanged.
