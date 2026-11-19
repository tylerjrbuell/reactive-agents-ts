---
"@reactive-agents/reasoning": patch
---

Three root-cause fixes from the live zoo validation. `leanFinalTurn` now extracts file inputs through dot-directory paths (`.bench-run-*`, `~/.config`) and fails closed when the task names a file it cannot parse, so it no longer ends a run after reading one of two files. An honest decline settles after one failed call for permanent errors (ENOENT, 404, not found), so `actOrAnswer` no longer forces a second read of a missing file. Invented percent benchmarks are now hard fabrication violations; figures present in tool results or the task text stay allowed.
