---
"@reactive-agents/runtime": patch
---

`agent.session({ initialPlanFindings })` seeds a conversation's stored plan findings next to `initialTodo`. A session rebuilt after a restart or eviction keeps `session.plan.findings`, carries them into the next execute turn, and `setPlan(steps)` keeps them. Malformed rows are dropped and duplicates kept once.
