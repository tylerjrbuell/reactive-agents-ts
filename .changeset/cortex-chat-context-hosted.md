---
"@reactive-agents/cortex": patch
---

Chat context meter now shows a reading for hosted models (OpenAI, Anthropic, Gemini). The framework only reports a context window for Ollama, so those turns showed tokens and cost but "no reading yet". Cortex now derives the reading from each call's reported prompt tokens and the framework capability window, and only when the model has a real capability row (never the conservative fallback).
