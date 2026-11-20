---
"@reactive-agents/tools": minor
---

MCP OAuth sign-in is now a public API: `mcpLogin(endpoint, opts)` runs the interactive authorization-code + PKCE flow over a `127.0.0.1` loopback redirect and saves the tokens to the token store (default `~/.reactive-agents/mcp-auth`). `mcpAuthStatus(endpoint)` reports `signed-in`, `expired` or `absent`, `mcpLogout(endpoint)` revokes the refresh token where the server supports it and deletes the stored login, and `listMcpLogins()` lists every stored login. None of them return token values. Pass `onAuthorizationUrl` to show the sign-in link in your own UI; no browser opens unless you also pass `openBrowser: true`. Logins made with earlier `rax mcp login` versions keep working.

An HTTP MCP server configured with only a URL (no `auth`) now uses a login stored for that exact URL. The stored token is sent only to that URL, and it refreshes when it expires. Set `auth: false` to opt out. Servers with no stored login behave as before.
