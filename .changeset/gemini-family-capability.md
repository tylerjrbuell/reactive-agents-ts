---
"@reactive-agents/llm-provider": patch
---

Gemini model ids that are not in the built-in capability table, such as `gemini-flash-latest`, `gemini-pro-latest`, dated `-preview` ids and new versions, now get the capabilities of the nearest listed model of the same variant (pro, flash or flash-lite): the real 1M-token context window, thinking support and output limit. They used to fall back to a 2048-token window with thinking off. These rows have `source: "inferred"`. Listed models are unchanged. Non-text models (embedding, TTS, image, live) and ids with no recognizable variant still use the fallback.
