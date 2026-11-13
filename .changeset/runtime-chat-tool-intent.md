---
"@reactive-agents/runtime": minor
---

`agent.chat()` and `session.chat()` now take the tool loop whenever the agent has a capability tool (custom tool, MCP server, sub-agent, terminal, opted-in built-in, or documents), instead of guessing from the message wording. Before, "what is the price of bitcoin?" went to the direct-LLM path on an agent with a price tool, and the model answered that it had no such tool. The model can still answer a plain message in one iteration via `final-answer`; an agent with no capability tools stays on the direct path. Behavior change: tools agents now run a kernel iteration for every chat message. `session.chat()` without `useTools` used to always go direct; it now follows the same rule.

`.withToolIntent()` accepts `"capability"` (the new default), `"message"` (opt back in to the old wording heuristic) or your own `(message) => boolean` classifier. Per-call `{ useTools }` still wins. `requiresTools()` is deprecated; it is kept for compatibility and for `"message"`. `ToolIntent` is exported. Hosts that pass their own `{ useTools }` (such as Cortex) are unaffected.
