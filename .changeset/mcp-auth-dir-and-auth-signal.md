---
"@reactive-agents/tools": patch
---

MCP OAuth: set `REACTIVE_AGENTS_MCP_AUTH_DIR` to move the stored-login directory (default `~/.reactive-agents/mcp-auth`); it is read when a store is built, so tests and host apps can keep logins out of the real home directory (`resolveMcpAuthDir`, `MCP_AUTH_DIR_ENV` exported). A failed MCP connect's `MCPConnectionError` now carries `status` (the HTTP status seen, e.g. 401) and `reason: "auth-required"` when the server needs a sign-in, so hosts no longer parse the message. `MCPServer.tokenStore` docs now say the default is the shared file store, not in-memory.
