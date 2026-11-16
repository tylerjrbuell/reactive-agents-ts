---
"@reactive-agents/cortex": patch
---

Cortex no longer runs judgment when the Judgment section is unchecked. It sets `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` at startup (unless already set), stopping the framework's auto-shadow judgment backend from flooding the local Ollama with `/v1/systemone` calls alongside chat turns. Checking Judgment in the Lab still enables it.
