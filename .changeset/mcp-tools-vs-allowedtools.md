---
"@reactive-agents/runtime": patch
---

Tools of an attached MCP server are no longer hidden by `allowedTools`. The ToolService allowlist wrapper (list, describe, execute, function-calling schemas) now applies the same rule as the run setup: MCP tools of a server with no `server/tool` entry in the allow-list stay visible and callable; explicit `server/tool` entries still restrict that server; `forbiddenTools` still hides. Previously an agent with `allowedTools` set (as Cortex chat always does) could not call any MCP tool.
