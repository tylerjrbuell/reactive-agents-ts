---
"@reactive-agents/runtime": minor
---

Plan recon is wired through the runtime. `planRecon` is a first-class harness key (`.withHarness({ planRecon: true })` or `RA_PLAN_RECON=1`, default off) and the run-started config records it. The kernel tool schema now carries each tool's `effect` (`read`, `write` or `unknown`, from `toolEffect`), so plan recon can find read-only tools; an approval-gated read tool stays `unknown`. Recon results come back as `Plan.findings` from `agent.plan()` and on `PlanRecorded`. `agent.execute(plan)` and `agent.run(input, { plan })` pass the findings to the execute run as context, `result.plan` keeps them, and a user-edited plan keeps them. Sessions hold findings across turns: `session.plan.findings` shows them, `session.setPlan(steps)` keeps them and `session.setPlan(plan)` takes the findings that plan states. With user interaction wired, plan turns can ask the user through `request_user_input`.
