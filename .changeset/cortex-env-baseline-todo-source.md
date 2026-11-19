---
"@reactive-agents/cortex": patch
---

Chat environment notices no longer report a stale "to-do list edited" line. The environment baseline moves only when a turn settles (not on every read), and to-do edits count only the user's own dock edits; to-do lists applied from an agent's session-control proposal are not reported as user edits.
