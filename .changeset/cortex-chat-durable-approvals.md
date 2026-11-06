---
"@reactive-agents/cortex": minor
---

Chat turns that pause on a durable approval gate can now be approved, denied or dismissed from an approval card in the chat thread (or from the desk's pending approvals). The resumed reply lands in the same thread instead of a "Run paused" message, new messages wait until the paused turn is decided, and paused turns survive a server restart. New routes: `GET /api/chat/sessions/:id/approvals` and `POST /api/chat/sessions/:id/approvals/:runId/approve|deny|dismiss`.
