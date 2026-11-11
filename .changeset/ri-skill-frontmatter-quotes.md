---
"@reactive-agents/reactive-intelligence": patch
---

SKILL.md front matter now unquotes YAML-quoted scalar values. `name: "my-skill"` and `name: 'my-skill'` both parse to `my-skill` (previously the quotes were kept in the name). Double-quoted values honor backslash escapes; single-quoted values honor `''`. Unquoted values, including ones with colons or inner quotes, are unchanged.
