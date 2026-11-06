---
"@reactive-agents/cortex": minor
---

Chat turns that pause on `request_user_input` now show the agent's question in the thread with a reply box (Yes/No, choice buttons, form fields or free text). Answering resumes the run through `respondToInteraction`, and the question, the answer and the reply land in the thread; Dismiss drops the turn. New route: `POST /api/chat/sessions/:id/interactions/:runId/respond|dismiss`. The non-stream chat path now holds approval and question pauses too, instead of saving the "Run paused" text as a reply.

The Cortex server now binds `127.0.0.1` by default, so only this computer can reach it (Cortex has no authentication). Set `CORTEX_HOST=0.0.0.0` (or pass `hostname` to `startCortexServer`) to expose it on purpose; the server logs a warning when it listens beyond loopback. `startCortexServer` now returns `{ hostname, port, stop }`.
