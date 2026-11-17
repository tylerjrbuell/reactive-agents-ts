---
"@reactive-agents/reasoning": minor
---

`ReasoningService.execute` takes `planOnly: true`: `blueprint` and `plan-execute-reflect` stop after the plan (the planner call or a supplied plan, plan repair, plan-time argument grounding and, for `blueprint`, VERIFY). No tool runs and no solve or synthesis call is made. The result is `partial` with no output, `metadata.planOnly: true`, `metadata.rawTerminatedBy: "plan-only"` and the plan, every step pending, in `metadata.extensions.plan`. `adaptive` routes a plan-only run to one of the two and does not fall back to reactive; any other strategy fails with an `ExecutionError` instead of running the task.
