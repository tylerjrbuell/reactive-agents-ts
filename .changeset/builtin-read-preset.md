---
"@reactive-agents/tools": patch
---

Add a `read` builtin toolset alias (`file-read`, `list-directory`, `grep`): a read-only filesystem preset for `.withTools({ builtins: ["read"] })`. Export the `BuiltinToolsetAlias` type and `isBuiltinToolsetAlias()` so callers can derive preset names from the alias table. Alias lookup now matches own keys only, so a token such as `constructor` is treated as a literal tool name instead of hitting `Object.prototype`.
