---
"@reactive-agents/reasoning": patch
---

`repetitionGuard` no longer blocks a corrective write. The converging-retry exception now reads the last call to the same target (path, URL, id), not the last call to the tool. A failed `by-region.json` write followed by a successful `report.md` write no longer blocks the corrected `by-region.json`. A rewrite of an already-written target with different content also runs when another tool returned new evidence since the last write to that target (write `out-2.txt` = 34, read `notes-2.txt`, rewrite `out-2.txt` = 84). This holds under an exhausted stalled requirement too. A rewrite with no new evidence in between, or with the same content, is still blocked.
