---
"@reactive-agents/runtime": patch
---

A chat turn that takes the direct (tools-off) path no longer forces `temperature: 0.7` on the model call. It now uses the agent's configured temperature, the same one `run()` and tool-loop chat turns use. Agents with no configured temperature keep the provider default (0.7), so unconfigured agents behave as before.
