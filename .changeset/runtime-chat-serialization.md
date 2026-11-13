---
"@reactive-agents/runtime": patch
---

Chat turns on one session are now serialized. Concurrent `session.chat()` / `agent.chat()` calls (and streamed turns) on the same conversation used to read the same history and each append their own user/assistant pair, corrupting the thread. They now queue first-in-first-out; a failed turn releases the queue, and a streaming turn holds its place until the stream ends or the consumer stops iterating. Error messages in the gateway, journal, finalize and error-suggestion paths now come from the shared `errorMessage` helper, so non-Error rejections with a `message` render it instead of `[object Object]`.
