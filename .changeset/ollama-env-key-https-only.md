---
"@reactive-agents/llm-provider": patch
---

Ollama: `OLLAMA_API_KEY` from the environment is now attached only to https endpoints (or `https://ollama.com`), never to loopback or plain http hosts. Previously it was sent as a Bearer token to whatever endpoint resolved, including cleartext LAN hosts. An explicit `apiKey` passed to `.withProvider("ollama", { apiKey })` is still always honoured; `resolveOllamaTarget` now returns a secret-free `warning` when a key is withheld or would travel over cleartext http.
