---
"@reactive-agents/runtime": patch
---

Tools of an attached MCP server are no longer hidden by `allowedTools`. Previously an agent with `allowedTools` set (as Cortex chat always does) could not call any MCP tool. They now join the allowlist automatically, so you do not list each `server/tool` by hand:
- Naming any `server/tool` of a server in `allowedTools` keeps the list authoritative for that server.
- `forbiddenTools` and `.withContract()` forbidden tools stay hidden.
- The ToolService allowlist wrapper (list, describe, execute, function-calling schemas) applies the same rule as the run setup.

The declarative agent config (`mcpServers[]`) now carries `readOnly` (`true` or a list of tool names) and `trustAnnotations`, so the operator read-only marking works from JSON config and survives `toConfig()` round trips.
