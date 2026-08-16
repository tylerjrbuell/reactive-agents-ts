---
"@reactive-agents/tools": minor
"@reactive-agents/reasoning": patch
---

Added — bounded scratchpad with disk spill (#47)

Tool-result auto-store (`ResultCompressionConfig`'s `autoStore`) writes overflow
into the run's in-memory scratchpad, which had no aggregate size cap and no
disk persistence — a long run accumulating many/large auto-stored tool
results grew it unbounded, and content was lost if the process died without
a durable checkpoint. Writes past a configurable aggregate byte threshold
(default 5MB) now spill to `~/.reactive-agents/spill/<namespace>/<key>.txt`;
reads (the `recall` tool, deliverable assembly, evidence grounding) resolve
spilled entries back to their full content transparently. Namespaced by
session/agent ID so concurrent runs' identically-named keys never collide.

Fixed — tool definitions are validated at registration, not silently accepted (#57)

`ToolService.register()` accepted any object typed `ToolDefinition` with zero
runtime check — a raw object literal, an `as any` cast, or a definition
assembled dynamically from an MCP server's advertised schema could all carry
a malformed shape (missing description, a parameter with no name) that was
silently stored and only failed much later, deep in execution, with no
indication the definition itself was the problem. Registration now runs the
definition through `Schema.decode` and fails immediately with a typed
`ToolDefinitionError` naming the tool and the field.

Fixed — a custom tool returning `undefined` or a circular reference fails clearly (#58)

A custom tool's return value was serialized with a bare `JSON.stringify` and
no error handling: `undefined` silently stringifies to the JS value
`undefined` (not the string `"undefined"`), turning the tool's observation
content into a non-string that broke downstream string operations far from
the actual cause; a circular reference threw an uncaught generic `TypeError`
with no tool-name context. Both now produce a clear, named tool-execution
failure at the point of cause instead.
