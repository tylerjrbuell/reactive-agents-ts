---
"@reactive-agents/observability": patch
---

The status renderer prints "⏸ Paused" instead of "✗ Failed" for a run paused at an approval gate or pending interaction. The `completion` log event has an optional `paused` field.
