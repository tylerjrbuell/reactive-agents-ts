---
"@reactive-agents/tools": minor
---

Custom and MCP tools can now be marked read-only. `defineTool` accepts `mutatesExternalState` (set `false` to declare a tool read-only). MCP server config accepts operator-set `readOnly` (`true` or a list of tool names) and `trustAnnotations` (honor the server's `readOnlyHint`); `destructiveHint` or `openWorldHint` always wins, and unset config behaves exactly as before.
