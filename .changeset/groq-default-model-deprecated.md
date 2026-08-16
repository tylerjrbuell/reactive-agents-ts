---
"@reactive-agents/llm-provider": patch
"create-reactive-agent": patch
---

Fixed — Groq default model swapped off deprecated `llama-3.3-70b-versatile`

Groq shut down `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on
2026-08-16. The Groq provider's default/fallback model (used when no
`.withModel()` is given) and the `create-reactive-agent` scaffold default
now point to `openai/gpt-oss-120b`, Groq's recommended replacement — same
131K context window, native tool calling, lower cost. Callers who already
pass an explicit model are unaffected.
