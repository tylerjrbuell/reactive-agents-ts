---
"@reactive-agents/runtime": minor
---

Routes with `ack: { source: "model" }` now get agent-written acknowledgements from the built-in channel resolver. Per-conversation turns on such routes stream, and the text the agent writes before its first tool call is forwarded to `turn.onProgress`. The session also offers `acknowledge(turn)`: a separate tool-less completion (60 token cap, one short sentence) that skips the chat engine's per-session turn queue, is never added to history, and returns an empty string on failure so the router falls back to the canned text.
