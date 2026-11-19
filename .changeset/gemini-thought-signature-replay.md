---
"@reactive-agents/llm-provider": patch
---

Gemini 3-family models (for example `gemini-flash-latest`) no longer fail with `400 Function call is missing a thought_signature in functionCall parts` when a request replays earlier tool calls with no user text after them, such as a reflexion improve pass. The Gemini provider now keeps the `thoughtSignature` Gemini returns on each function call, on both `complete()` and `stream()`, and sends it back with that call. A call whose signature is unknown (history from another provider or another process) gets Google's documented placeholder signature. Gemini tool-call ids are now unique per call (`gemini-tc-…`); `complete()` used to return `call_0`, `call_1`, ….
