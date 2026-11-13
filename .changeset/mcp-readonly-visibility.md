---
"@reactive-agents/runtime": patch
---

Attached MCP server tools are no longer hidden by `allowedTools`: they join the allowlist automatically, so you do not list each `server/tool` by hand. Naming any tool of a server in `allowedTools` keeps the list authoritative for that server, and `.withContract()` forbidden tools stay hidden. The declarative agent config (`mcpServers[]`) now carries `readOnly` (`true` or a list of tool names) and `trustAnnotations`, so the operator read-only marking works from JSON config and survives `toConfig()` round trips.
