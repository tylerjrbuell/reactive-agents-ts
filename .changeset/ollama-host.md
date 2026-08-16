---
"@reactive-agents/llm-provider": patch
---

Fixed — Ollama `OLLAMA_HOST` honored

The capability-resolution probe only read `OLLAMA_ENDPOINT`, so `OLLAMA_HOST`
(Ollama's own standard env var) was silently ignored, producing conservative
2048-token fallback defaults against a live server. Both env vars are now
honored, and an explicit `numCtx` the caller already supplied is no longer
overridden by the fallback.
