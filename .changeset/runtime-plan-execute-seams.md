---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`agent.execute(plan, { strategy? })` and `agent.run(input, { plan })` can now run a supplied `Plan` in a strategy. An explicit `strategy` (`"blueprint"` or `"plan-execute-reflect"`) wins; an agent already on one of them adopts the plan; a plan with `dependsOn` or `args` runs in `blueprint` as a 0-LLM DAG; a free-step plan keeps the seeded ReAct loop. `result.plan` reports the plan the strategy ended with (from `metadata.extensions.plan`), keeping the plan's id, goal and source. A plan that does not decode, or whose `dependsOn` names an unknown step, itself or a cycle, now rejects `PlanInvalidError` before any run starts. A loop-stopped run with no checkpoint rail (non-durable runs, chat tool turns) now surfaces `result.loopStop` from `metadata.extensions.loopStop`. The harness keys `autoTick` and `bookkeepingRefund` (both default on) are accepted by `.withHarness()` and recorded in the run-started mechanisms. `resumeRun` guidance notes use the shared guidance writer.
