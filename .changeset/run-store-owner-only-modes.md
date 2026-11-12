---
"@reactive-agents/runtime": patch
---

Durable-run storage is now owner-only (directory 0700, `runs.db` 0600), and agent ids are contained to a single path segment in the default durable-runs directory so `../` or absolute ids cannot escape `~/.reactive-agents`.
