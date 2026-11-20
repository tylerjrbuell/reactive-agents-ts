---
"@reactive-agents/cortex": minor
---

Lab › Tools › Servers signs in to OAuth MCP servers without the terminal. Each HTTP server shows its sign-in state (signed in, expired, sign-in required) with Sign in, Cancel and Sign out; Sign in opens the server's authorization page and finishes on this computer's loopback redirect, then lists the tools. Logins made with `rax mcp login` that no saved server uses appear under "Signed in with rax" with one-click Add, and a saved server at the same URL uses that login. A Test or Refresh the server refuses for lack of a login now offers Sign in instead of a raw error. Test and Refresh also use a server's saved OAuth config. Sign-in is refused when Cortex is reachable from other machines without `CORTEX_TOKEN`.
