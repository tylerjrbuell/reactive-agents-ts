---
"@reactive-agents/reasoning": patch
---

Tool-error recovery hints are more accurate.

- A `file-edit` error saying its `oldText` was not found no longer gets a hint to call `list-directory`. The file exists; the edit text did not match. The missing-path hint now fires only on a real missing path (`ENOENT`, `no such file`, `file not found`).
- A tool error that already names the fix (`Closest valid call`, `Allowed commands`, `Valid:`, `Did you mean`, `Read the file first`, `Use <tool>`) no longer gets a generic hint appended.
