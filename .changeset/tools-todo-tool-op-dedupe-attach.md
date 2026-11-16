---
"@reactive-agents/tools": patch
---

`todo add`: a near-duplicate step that names a tool (structured or `(tool: x)` hint) now attaches that tool to the existing row when the row has none, instead of dropping it; the result says "set its tool to X". The local checklist fold handles the new core `tool` op.
