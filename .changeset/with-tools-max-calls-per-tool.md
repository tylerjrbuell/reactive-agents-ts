---
"@reactive-agents/runtime": minor
---

`.withTools({ maxCallsPerTool })` caps how many times each named tool may run in one agent run, for example `{ "web-search": 3 }`. A call past the cap is not run; the model gets a tool result saying the tool was not run and why. The cap counts the whole run, including several calls in one turn. Unnamed tools have no cap. Each cap must be a positive integer, or `.withTools()` throws `ToolsOptionError`. The option round-trips through `toConfig()` / `AgentConfig` as `tools.maxCallsPerTool`. The `reactive` (default) and `adaptive` strategies enforce it.
