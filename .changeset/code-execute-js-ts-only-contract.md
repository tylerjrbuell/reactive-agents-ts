---
"@reactive-agents/tools": patch
---

`code-execute` now tells the model up front that it runs JavaScript/TypeScript only (no shell, no Python), that data must be inline or read by absolute path, and shows a short compute example. A non-JS `language` value returns an explicit "JavaScript/TypeScript only" message instead of an opaque enum rejection, and the "missing sentinel" failure now reports the exit code, likely cause (`process.exit()`) and a hint.
