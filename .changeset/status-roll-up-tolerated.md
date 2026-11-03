---
"@reactive-agents/core": patch
"@reactive-agents/runtime": patch
"@reactive-agents/trace": patch
---

Measurement-only: the final run status is now derived by one runtime function (`deriveFinalStatus`), and `run-completed.outcome` gains optional `statusReason`, `tolerated` and `toleratedBy`. A run that the partial-substantive-output lane flips to success is now marked `tolerated`, and `rax-diagnose cause` no longer reports it as a `terminal-mislabel`. No run changes outcome.
