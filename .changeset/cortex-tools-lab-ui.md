---
"@reactive-agents/cortex": minor
---

Lab > Tools is now three tabs: Servers, Custom tools, and Catalog and test. The mixed "Create tool" panel is gone.

- **Servers**: a list with a state chip (Connected, Failed, Disabled, Not checked), tool count and last check, and a detail pane with Tools, Options and Credentials tabs. Add through a menu (Quick line, Form, Import JSON). Test shows the tool count or the reason it failed without changing the saved tools; an Enable switch turns a server off; credentials are write-only rows (a stored key shows Set, never its value).
- **Custom tools**: create and edit name, description and parameters with a JSON preview; disable, delete and try a tool in place.
- **Catalog and test**: unchanged catalog and test panel; tools of a disabled server show Disabled but stay testable.
- The Builder and chat Tools section share one MCP attach list with a strip showing read-only MCP tools, tools that ask first, and the shell, linking to Lab > Tools > Servers. A disabled server cannot be newly attached.
- Removed the `POST /api/tools/mcp-import-json` alias (it answered 410); use `POST /api/mcp-servers/import-json`.
