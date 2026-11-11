---
"@reactive-agents/tools": patch
---

Built-in and meta tool parameters with a closed set of valid values now declare them as a schema `enum`, not only in the description: `todo.action`, `brief.section`, `find.scope`, `relate.mode`, `relate.type`, `final-answer.format` and `final-answer.confidence`. Compact (local-tier) profiles drop parameter descriptions from the wire but keep `enum`, so these models used to see a bare `action: string` and could send a task title as the todo action.

`ToolParameter` gains an optional `aliases` map (off-enum word to canonical value, never sent to the model). The input validator now rewrites a case/whitespace variant of an enum value, or a declared alias, to its canonical value before the enum check, so `find({ scope: "internet" })` still runs as `"web"`. Values that match neither still fail with the list of valid values. One tightening: `relate` with an unknown `mode` now fails validation instead of silently running as `"links"`.
