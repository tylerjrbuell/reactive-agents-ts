---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex renders what the framework now reports, and a chat turn waiting on you survives a reload.

A run a guardrail ended (`AgentAborted` with reason `guardrail`) is stored and shown as **Blocked by guardrail** instead of Failed, in Runs, the run header and Beacon, and the "Why it ended" card names the guardrail. The run and chat Context tabs list the memories a run recalled into its context from its `MemoryRecalled` events (tier, summary, relevance, importance, the query, a link to the Memory studio entry); the "not reported" note stays only when a run reported none.

Pending approvals show which sub-agent is asking and are answered by gate id, so parallel sub-agents are approved or denied one at a time (`POST /api/runs/:runId/approve|deny` take `{ gateId }`; the toast, chat card, Runs strip, run header and Beacon all name who asks). ui-core mirrors `subAgent` on `ApprovalRequested` and `pendingApproval` (additive), adds `foldRecalledMemories` / `memoryRecalledOf`, and `statusOfRun("blocked")`.

A streamed chat turn is now detached from its SSE connection: closing or reloading the page no longer interrupts it. `GET /api/chat/sessions/:id/chat/active` reports a running turn and `GET /api/chat/sessions/:id/chat/stream/active?cursor=` re-attaches to its replayable event stream, so the page comes back with the pending approval or question card and the same run finishes after you answer. Stop stays explicit.

The chat titler, compactor and goal checker (with `/btw`) are built memory-off, so they no longer create memory folders or recall into their prompts.
