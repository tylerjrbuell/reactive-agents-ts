---
"@reactive-agents/cortex": patch
---

Fix the strategy card (code action, reflexion, tree of thought) vanishing when a chat turn ended. The turn's live strategy steps were streamed to the client but never reached the recorder that builds the stored turn, so nothing was persisted. They are now recorded with the turn (`TurnTraceRecorder.recordSteps`), so the card stays, collapsed, after the run and after a reload.
