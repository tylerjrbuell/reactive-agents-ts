---
"@reactive-agents/cortex": minor
---

Channel hub route editor gains a batch window (`batchWindowMs`, 0 to 30 000 ms) and a "while a turn is running" choice (`midRun`: queue, fold, interrupt), both hidden on webhook routes and validated before save. The hub header shows router inbox counts (received, running, done, failed, dropped) when the router reports a durable inbox, else an in-memory note. Chat sessions rebuilt from storage seed the plan's recon findings through `session({ initialPlanFindings })`, replacing the read-time stand-in.
