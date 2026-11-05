---
"@reactive-agents/reasoning": minor
"@reactive-agents/core": minor
"@reactive-agents/ui-core": minor
---

A plan-execute run now streams its plan as live checklist rows, with no `todo` tool call. Each plan step appears as an advisory row (`source: "plan"`) that moves from pending to in progress to done as the harness runs it, on the same `ChecklistUpdated` stream the `todo` checklist uses (so Cortex shows the plan as it runs). Plan rows are never marked done by evidence inference and never decide whether the run is complete; requirement rows still do. Plan-execute and blueprint tool calls also reach the live stream now, not only the final result.
