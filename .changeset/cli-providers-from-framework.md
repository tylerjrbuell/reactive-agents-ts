---
"@reactive-agents/cli": patch
---

`rax serve` now accepts `groq` and `xai`, and `rax run` checks `GROQ_API_KEY` / `XAI_API_KEY` for them. Every command takes its provider list from the framework, so a new provider works in the CLI without a separate edit.
