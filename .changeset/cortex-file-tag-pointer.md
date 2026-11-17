---
"@reactive-agents/cortex": patch
---

Cortex chat sends a tagged `@file` to the agent as a pointer (workspace path, size, "read it with file-read") instead of inlining the whole file, so paths mentioned inside the file no longer look like requests and context is not spent on text the agent may not need. A file of 2 KB or less is still placed in the block whole. Edit message now puts the message's tag chips back in the composer, Rerun sends the tags again, and the thread shows tags as chips, never as file text.
