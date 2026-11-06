---
"@reactive-agents/runtime": patch
---

`result.metadata.reasoningSteps` no longer carries inline media bytes. When a tool returns `toolContent(...)` with a base64 image or audio part, the step's `metadata.contentParts` now holds a short text stub (media type, decoded size, sha256 prefix) in place of the payload. The change applies to `run()` results, `StreamCompleted.metadata` on the stream and SSE wire, the durable `run_events` journal, and chat replies. URL-sourced media and file parts are unchanged. The bytes still reach the model during the run.
