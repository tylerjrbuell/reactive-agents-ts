---
"@reactive-agents/a2a": patch
---

The A2A client no longer follows redirects on JSON-RPC calls, so a configured `X-API-Key` or bearer token cannot be forwarded to a host you did not configure. The Signal MCP container now requires `@modelcontextprotocol/sdk` ^1.27.1.
