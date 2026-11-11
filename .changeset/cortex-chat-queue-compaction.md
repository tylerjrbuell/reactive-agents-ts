---
"@reactive-agents/cortex": patch
---

Cortex chat: the composer stays editable while a reply runs. Enter queues the next message and sends it when the reply finishes (Escape or Clear drops it). Text that would overwrite a draft (starter chips, `/help`, `/docs add`, Edit) sets the draft aside behind a Restore toast. Compaction summaries follow a fixed section structure, long chats are trimmed before summarising, and the context meter shows the post-compaction estimate immediately instead of the pre-compaction reading.
