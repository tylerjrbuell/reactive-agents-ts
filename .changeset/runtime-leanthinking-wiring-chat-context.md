---
"@reactive-agents/runtime": patch
---

Chat no longer leaks tool results across conversations. The tool path sends the raw message as the task (same as the streaming path) instead of prepending the agent's last-run debrief and tool results; the direct (tools-off) path now shows a session only its own latest tool results. `.withHarness({ leanThinking })` is accepted and recorded in `run-started.config.mechanisms` (default off).
