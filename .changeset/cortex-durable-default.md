---
"@reactive-agents/cortex": minor
---

Cortex builds chats, desk runs and gateway agents with Durable runs on unless you turn them off, so a Stop, a Pause or a crash leaves a run you can Continue instead of losing progress. An explicit off (the Builder's Execution switch, or `/durable` in a chat) is saved and kept; chats and saved agents from before the default have no setting and now read as on; a chat with tools off builds none. With it on, approvals and questions pause the run durably ("paused until you decide") instead of waiting live. Continue now streams: the reply fills in and tool calls appear as the resumed run works, with Pause and Stop working, instead of nothing until a reload (`POST /api/chat/sessions/:id/resume/:runId/start`).
