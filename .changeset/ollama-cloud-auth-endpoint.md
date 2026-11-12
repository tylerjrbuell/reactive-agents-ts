---
"@reactive-agents/llm-provider": patch
---

Ollama Cloud works end to end. The Ollama provider now honours `.withProvider("ollama", { baseUrl, apiKey })` per agent (env `OLLAMA_ENDPOINT`/`OLLAMA_HOST` and `OLLAMA_API_KEY` remain the fallback), and model discovery (`GET /api/tags`) sends the Bearer key like the capability probe and chat calls already did. New exports: `resolveOllamaTarget({ baseUrl, apiKey })` returns the endpoint, key and auth headers for one Ollama call; `checkOllamaConnection` is a pre-flight that returns a typed `OllamaAuthError` (with `status`) on 401/403. `OLLAMA_API_KEY` is sent only to the env-resolved endpoint, never to a different caller-named `baseUrl`.