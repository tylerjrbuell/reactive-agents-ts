---
"@reactive-agents/tools": patch
---

Host `code-execute` now kills the whole process group on timeout, so a child process the code started cannot keep the call open past the limit. A timed-out run returns `executed: false`, `timedOut: true`, an error naming the limit, and the console output printed before the kill. `CodeExecuteConfig` gains `timeoutMs` (default 30s; the definition timeout follows it) and `recall`. The description and the "storage key, not code" refusal tell the model to call `recall` only when `recall: true` says it is registered; otherwise they tell it to inline the text.
