---
"@reactive-agents/runtime": minor
---

`.withChannels` now passes `inbox: { path }` (opens and closes the durable SQLite router store), `outbox` (retry and pacing) and `followUp` through to the channel router. With `followUp`, or routes using `midRun: "fold"` or `"interrupt"`, each conversation runs on its own agent: the `follow-up` tool is registered on it (never on a `ReadOnly` surface), folded messages are attached to the next custom tool result, and an interrupted turn aborts its stream. `agent.channelRouterStatus()` reports `inbox`, `outbox` and `timers` counts.
