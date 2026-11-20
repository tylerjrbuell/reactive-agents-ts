---
"@reactive-agents/runtime": patch
---

`.withMCP()` accepts `auth: false`. A URL-only HTTP MCP server (no `auth`, no `Authorization` header) now uses a stored `rax mcp login` / `mcpLogin()` login for that exact URL; `auth: false` opts a server out. AgentConfig JSON keeps `auth: false` (OAuth credential objects stay code-only).
