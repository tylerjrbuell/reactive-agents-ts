---
"@reactive-agents/reasoning": patch
"@reactive-agents/observability": patch
---

Fixed — status line no longer prints `Done`/`Failed` twice per run

Every reasoning strategy fired its own `completion` event in addition to
the authoritative one the runtime fires at true run end, so the terminal
status renderer always printed two summary lines (and stopped its elapsed
timer early, before the run actually finished). Also fixed a status-line
tool-error message that could cut off mid-word with no indication it was
truncated.
