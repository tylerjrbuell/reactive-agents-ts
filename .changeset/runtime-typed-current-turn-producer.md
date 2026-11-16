---
"@reactive-agents/runtime": patch
---

Chat runs now state the current turn as typed data. `run()`, `runStream()` and the gateway chat path set `task.metadata.currentTurn` (the user's message without the folded-in history block), and intent readers (tool relevance, strategy routing, skill matching) read it before falling back to parsing text markers. Runs with no history are unchanged.
