---
"@reactive-agents/reasoning": patch
---

Plan-execute runs now record the tool calls their composite steps make. A composite step runs its own reasoning loop, and before this its tool calls (for example a `file-write`) were missing from `result.metadata.runLedger`, so tool-usage and deliverable receipts did not show them.
