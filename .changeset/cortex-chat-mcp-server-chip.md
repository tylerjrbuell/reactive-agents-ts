---
"@reactive-agents/cortex": patch
---

Cortex chat: the Tools chip counts the tools of the MCP servers turned on again (label "web-search +5", tooltip "web-search; umami: 3 tools (...)"). Regression since attaching a server stopped writing its tools into the chat tool list. A server with no cached tools is listed on demand and shows "listing tools" or why it could not connect.
