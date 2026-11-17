---
"@reactive-agents/cortex": patch
---

Cortex chat: approving or denying a paused tool call is now a live turn. Approve answers at once, the approval card goes away and the chat returns to the live view, where the approved call shows as a normal tool call that runs and then carries its parameters and result (kept after a reload) while the run keeps streaming; before, the card sat on "Running shell-execute..." until the command and the rest of the run had finished. The approval card also gets a "Show full parameters" expander for long, multi-line or nested arguments (secrets still masked).
