---
"@reactive-agents/llm-provider": patch
---

`.withProvider(p, { apiKey })` now works for every provider. The Anthropic, Gemini and Ollama adapters used to ignore it and read only `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `OLLAMA_API_KEY`. Now the passed key wins over the env var for all adapters, so you can set a per-agent key for any provider. When a provider rejects a key passed this way, the error now says to check the key passed to `.withProvider`. Before, it told you to set an env var that the adapter never read.
