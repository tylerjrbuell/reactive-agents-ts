---
"@reactive-agents/cortex": patch
---

Chat provider picker: providers with no API key, or an unreachable Ollama, show greyed out with the reason and cannot be picked. Switching provider keeps the current model when the new provider lists it, otherwise uses that provider's default.
