---
"@reactive-agents/tools": patch
---

`request_user_input` now publishes the item schema of `questions` (`id`, `prompt`, `type` required; `options` for choice types), generated from the parser's own schema, and `ToolParameter.items` can carry `properties`/`required`. A call mixing the legacy `prompt`/`kind` form with `questions` is repaired when unambiguous (alias type, string options, missing id, top-level prompt) instead of rejected; other malformed calls are rejected with a valid example. `todo` `edit` accepts `items: [{id, text}]` as a multi-rename and otherwise names the accepted shapes.
