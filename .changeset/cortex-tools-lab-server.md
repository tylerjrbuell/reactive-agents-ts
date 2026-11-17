---
"@reactive-agents/cortex": minor
---

Tools Lab server routes: MCP servers keep a connection status, can be tested without touching their tool list (`POST /api/mcp-servers/:id/test`), switched off (`PATCH /api/mcp-servers/:id/enabled`; an agent never starts a disabled server on any path), return per-tool input schemas (`GET /api/mcp-servers/:id/tools`) and take per-key write-only credential edits (`PUT /api/mcp-servers/:id/secrets`). Custom tools can be edited in place (`PATCH /api/tools/lab-custom/:id`). `POST /api/tools/mcp-import-json` now answers 410; use `/api/mcp-servers/import-json`.
