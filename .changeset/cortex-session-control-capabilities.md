---
"@reactive-agents/cortex": minor
---

Cortex chat: the agent's session-control proposals are now part of the thread and cover most of the session.

- The "The agent proposes" banners no longer outlive the conversation: clearing a chat deletes them, rewinding removes the ones the rewound turns made, compacting drops the settled ones, and a fork starts without them. The UI re-reads them at once, so nothing lingers until a reload.
- Identical proposals collapse to one card (the tool also tells the agent "already proposed" instead of stacking another), applied and dismissed proposals shrink to a one-line row, and every banner can be removed (`DELETE /api/chat/sessions/:id/proposals/:proposalId`).
- With Agent control on, `/agent` now has "Let the agent change" switches (all off by default): tools (add or remove a tool or toolset, enable a configured MCP server), limits and strategy (max steps, strategy, context budget), memory tiers, system prompt, approvals, workspace folder, and conversation (to-do list, compact, fork, rewind). A read-only `describe-session` action lets the agent see its effective setup.
- Every proposal shows a before and after diff. Nothing applies without your Apply, except a stricter change in a group you also allowed to auto-apply; a looser change can never auto-apply, and a chat that reads outside content marks its proposals with a warning and never auto-applies them. The full host shell cannot be proposed.
