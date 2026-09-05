---
"@reactive-agents/runtime": minor
---

Add `.withToolIntent()` for agent-level tool-routing overrides in `chat()`, a `verifyCitations` option on `ChatOptions`, and an `onOverflow` history-overflow-summarize hook on `AgentSession`, so a long-running chat session can summarize older turns instead of silently dropping them.
