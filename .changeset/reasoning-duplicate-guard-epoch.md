---
"@reactive-agents/reasoning": patch
---

A repeated identical tool call now runs again when a successful file-write, file-edit, shell-execute or code-execute landed since its last result, instead of replaying the stale result. Re-running tests after editing now sees the edit.
