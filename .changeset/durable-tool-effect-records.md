---
"@reactive-agents/core": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
---

Durable tool-effect records (GH #262): a crash after a side-effecting tool succeeds but before the next checkpoint commits is no longer silently at-least-once. `.withDurableRuns()` runs now persist one awaited `run_effects` row per tool call (pre-dispatch `executing` write + terminal outcome write), the kernel records effects through the new `RunControllerLike.onToolEffectStart`/`onToolEffectEnd` seam with framework-minted ids and canonical args identity, and `resumeRun()` consults the store: a recorded-succeeded effect is recovered by injecting its stored result without re-executing the tool, while a terminal-less record replays AND is named `ambiguous-then-replayed` on the trust receipt (`receipt.effects[]`, present only after a crash-window recovery, so ordinary receipts are unchanged).
