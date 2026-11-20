---
"@reactive-agents/cli": patch
---

`rax mcp login | logout | status` now run on the public `mcpLogin` / `mcpLogout` / `listMcpLogins` API from `@reactive-agents/tools`, so the CLI, Cortex and your own code share one sign-in flow. Flags are unchanged. `rax mcp login <name>` records the server name with the login, and `rax mcp status` shows that name plus a `Status` line (`signed-in` or `expired`). It still never prints token values. `status` now skips stored records that hold no tokens (for example, only a registered client). `--scope "a b"` is sent as two scopes.
