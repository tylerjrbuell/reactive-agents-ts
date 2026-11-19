---
"@reactive-agents/tools": patch
---

MCP tools that declare an `outputSchema` now get a `returnType` on their tool definition: a compact type string such as `{ websites: { id: string; name: string }[]; total: number }` (object nesting capped at 3 levels, at most 240 characters). Code-action tool bindings render it as `Returns: <type>`, so the model can read the right result properties on its first attempt instead of guessing the shape. `MCPToolSchema` carries the server's `outputSchema`. MCP tools without an `outputSchema` are unchanged.
