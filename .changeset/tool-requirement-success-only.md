---
"@reactive-agents/reasoning": patch
---

A required tool now counts as done only after a call to it succeeds. Before, the run assessment credited any call, so a failed `file-write` recorded `tool:file-write` as satisfied in the run ledger, and guards and the exit gate treated the work as done. A failed call now leaves the requirement outstanding, and a later successful call satisfies it.
