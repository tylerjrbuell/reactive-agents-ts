# tools/

Built-in tools and MCP (Model Context Protocol) server connections.

| #   | File           | Shows                                                                         | Offline? |
| --- | -------------- | ----------------------------------------------------------------------------- | -------- |
| 05  | builtin-tools  | All 8 built-in tools (file-write/read, code-execute, scratchpad, spawn-agent) | ✅       |
| 06  | mcp-filesystem | MCP filesystem server via stdio — reads `/tmp` via agent                      | ⚡       |
| 07  | mcp-github     | MCP GitHub server — queries repo info via agent                               | ⚡       |

MCP examples require running MCP servers. See each file's header comment for setup.

Run offline only: `bun run ../../index.ts --filter tools --offline`
