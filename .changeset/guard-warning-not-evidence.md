---
"@reactive-agents/reasoning": patch
---

The harness's own warning for a repeated tool call ("you have already called this tool N times") no longer counts as progress. It was recorded like a real tool result, so it could reset the no-progress counter and keep a stuck run going. Guard observations are now marked as harness-authored in the run ledger and classified as non-progress.
