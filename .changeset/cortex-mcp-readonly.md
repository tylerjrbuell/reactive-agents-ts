---
"@reactive-agents/cortex": minor
---

Cortex MCP servers can declare themselves read-only (all tools, or named tools) and trust the server's own read-only hints; both are saved with the server and reach the agent. Attaching an MCP server in the Lab tool picker or the chat `/mcp` menu now makes all of its tools available, with no need to select each one; clicking a tool leaves it out. Saved agents with explicit `server/tool` lists keep working unchanged.
