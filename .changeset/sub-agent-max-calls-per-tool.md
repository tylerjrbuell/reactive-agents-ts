---
"@reactive-agents/runtime": patch
---

Sub-agents now run under the parent's `.withTools({ maxCallsPerTool })` caps. Before this, a delegated child dropped them and could call a capped tool as often as it liked. A child started with `spawn-agent` gets the parent's caps as they are. The model writes the spawn arguments, so it cannot loosen them. A `.withAgentTool()` sub-agent can set its own `maxCallsPerTool`. Its map is merged over the parent's, and its cap wins for the same tool name. A cap that is not a positive integer makes `.withAgentTool()` throw `ToolsOptionError`, the same as `.withTools()`. `createLightRuntime` accepts `maxCallsPerTool` too.
