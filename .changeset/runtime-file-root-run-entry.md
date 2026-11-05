---
"@reactive-agents/runtime": patch
---

File tools now stay inside the caller's file root for the whole run. `run()`, `runStream()` (and `chat()` through it), `runEffect()`, durable runs, and the approve/deny/resume facades bind the `withFileRoot(...)` root onto the run fiber when the run starts. Before, a relative `file-write` could resolve against `process.cwd()` once Effect's scheduler lost the AsyncLocalStorage root.
