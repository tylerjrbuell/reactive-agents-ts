---
"@reactive-agents/runtime": patch
---

`AgentSession.chat()` and `AgentSession.runStream()` now accept `string | ContentPart[]` like `agent.chat()` and `ChatEngine.turn()`, so a session turn can carry images and audio (a no-vision model fails with `UnsupportedModalityError`). The declared return type of `listPendingApprovals()` now includes the optional `subAgent` field it already returned.
