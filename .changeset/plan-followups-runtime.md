---
"@reactive-agents/runtime": patch
---

Plan follow-ups. Plan provenance now reads the checklist row `origin` (`agent.plan()` and `session.plan` report `source: "harness-derived"` when the harness derived the steps), and a step's `tool` hint rides the to-do seed so the execute run can act on it. Buffered `session.chat()` tool turns carry the to-do list like streamed turns, chat session turns publish `PlanStepStatusChanged` (and `PlanRecorded`) stamped with `sessionId`, and durable agents honor `run(input, { plan })`, `initialTodo` and plan posture. `planToolCatalog` is on by default; set `.withHarness({ planToolCatalog: false })` or `RA_PLAN_TOOL_CATALOG=0` to turn it off.
