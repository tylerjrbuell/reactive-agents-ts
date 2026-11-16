---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Plan then execute is now a framework primitive, usable without any UI. `agent.plan(input)` runs the task under plan posture (planning tools only) and returns a typed `Plan` (`{ id, goal, steps, createdAt, source }`) that always has steps: the model's `todo` list, else steps the harness derives from the reply, else a typed `PlanNoStepsError` rejection. `agent.execute(plan)` and `agent.run(input, { plan })` run seeded from the plan's checklist (the follow-the-list guidance rides that seed) and add `result.plan` with each step's final status; an empty or absent plan runs exactly as before. `PlanRecorded` and `PlanStepStatusChanged` are published on the EventBus. Chat sessions gain `session.plan` (the conversation's to-do list as a `Plan`) and `session.setPlan(planOrSteps)` (edit before switching to execute). `planToolCatalog` is a typed `.withHarness({ planToolCatalog: true })` flag (default off), recorded in the run's mechanisms.
