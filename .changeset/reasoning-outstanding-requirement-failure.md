---
"@reactive-agents/reasoning": patch
---

A run that was asked to perform an external action (send a message, open a ticket, schedule an event) no longer finishes as `success` just because a read-only tool succeeded. Web search, HTTP GET and file reads are retrieval, so their success is never counted as the requested side effect landing. When nothing that can change the world succeeded, the exit gate keeps the action outstanding and the run ends as a failure that names it ("actually complete the requested action"), instead of `end_turn` with a passing verdict.
