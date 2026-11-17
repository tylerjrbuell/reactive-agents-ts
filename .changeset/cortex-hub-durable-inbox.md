---
"@reactive-agents/cortex": minor
---

The channel hub now runs the framework's durable SQLite inbox, outbox and follow-up timers on the Cortex database. After a restart or crash an orphaned turn is retried once, a redelivered message does not run twice, and a reply left pending is sent. The hub header shows inbox, outbox and timer counts instead of the in-memory note. `CORTEX_CHANNEL_INBOX=memory` restores the in-memory behavior.
