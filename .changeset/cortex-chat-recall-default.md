---
"@reactive-agents/cortex": patch
---

New Cortex chats keep the `recall` meta-tool on, so the agent can read back the rest of a large tool result instead of losing it. `recall` retrieves results stored during the current run; it is not cross-run memory, which stays off for chats. Chats created earlier keep their saved setting.
