---
"@reactive-agents/runtime": patch
---

A run is no longer marked failed when its only unmet item is the generic "answer" requirement and every declared deliverable (for example a file the task named) verifiably landed. The artifacts are the answer, the same rule the empty-output check already uses. A rejected verdict, a failed verifier check or any outstanding requirement still fails the run.
