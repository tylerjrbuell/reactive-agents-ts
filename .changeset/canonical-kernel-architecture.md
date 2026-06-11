---
"@reactive-agents/reasoning": minor
"@reactive-agents/core": minor
---

Canonical kernel architecture refactor. The reasoning kernel is now organized into capability-grouped modules (act, attend, comprehend, decide, learn, reason, recall, reflect, sense, verify) with an acyclic dependency mesh. Termination has a single owner: every exit path routes through the arbitrator and `terminate()`, and a state-grounded post-condition spine validates that "done" claims are backed by evidence before a run completes. Context assembly is unified on the `project()` pipeline — an event log plus content-addressed result store with recency-aware, two-budget projection — replacing the previous parallel assembly paths. Kernel state changes go through `transitionState()` exclusively, making run state machine-checkable.
