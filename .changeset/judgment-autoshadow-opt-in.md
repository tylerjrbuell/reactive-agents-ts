---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Judgment auto-shadow is now opt-in. Before, every `build()` that could reach Ollama at `/api/tags` silently wired a judgment service on the `nimble` model, without checking that the model was installed, and wrote to `~/.reactive-agents/judgment-shadow.db`. A default `build()` now makes no Ollama call for judgment and writes no shadow DB. To opt in, use `.withJudgment({ shadow: true })` (optional `model`, default `nimble`, and `baseUrl`) or set `REACTIVE_AGENTS_AUTO_SHADOW=1`. With the opt-in, the service is wired only if the model is listed in `/api/tags`. `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` and `.withJudgment(false)` still turn auto-shadow off, and both override the env opt-in.
