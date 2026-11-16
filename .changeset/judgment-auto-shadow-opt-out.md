---
"@reactive-agents/runtime": patch
---

`.withJudgment(false)` turns judgment off and opts out of the build-time auto-shadow probe (no Ollama `/api/tags` call, no observation-only shadow backend, no `judgment-shadow.db`). Default behavior is unchanged, and `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` still works.