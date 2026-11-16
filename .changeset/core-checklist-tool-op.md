---
"@reactive-agents/core": patch
---

Add the `tool` checklist op (`{ op: "tool", id, tool? }`) to set or clear a row's tool hint without removing the row; an explicit tool wins over a hint parsed from the title, and clearing falls back to the text hint.
