---
"@reactive-agents/runtime": patch
---

A tools-off `chat()` / `session.chat()` whose model call fails now rejects with the provider's own error. `err.message` is the cause (for example `Model "x" not found locally. Run: ollama pull x`) with no `LLMError: ` prefix, and `err._tag` names the error class. It used to reject with a wrapper whose message started `LLMError: `. The direct path still rejects; the tool-capable path still resolves with `failed: true`.
