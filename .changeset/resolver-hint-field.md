---
"@reactive-agents/tools": patch
---

The native-FC tool-call resolver now returns its reprompt hint for an unresolved call (unparseable call text, or a tool name that is not on the surface) in a typed `hint` field on the `thinking` result. Read `hint` instead of splitting `content`. For one release `content` still carries the raw reply and the hint joined by a blank line, so existing consumers keep working; after that, `content` will be the raw reply alone.
