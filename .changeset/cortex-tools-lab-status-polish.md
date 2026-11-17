---
"@reactive-agents/cortex": patch
---

Lab > Tools: opening the Servers tab checks every enabled server that was never checked or was last checked over 10 minutes ago, in the background (two at a time, 15 seconds each, one per server), so chips read Checking… then Connected or Failed without a manual Test; Recheck all in the list header. The three tabs share one layout (search and the one primary action in the list header, a count line, the first item shown), the tab counts use the UI face so a zero no longer reads as an 8, and the stray scrollbar bars and the collapsed tools search are gone.

A switched-off MCP server is no longer offered anywhere an agent is configured (Builder and chat tool lists, `/mcp`, the quick bar, plan step tools); a config that still lists one shows "Uses a disabled server (skipped)" with an Enable button.
