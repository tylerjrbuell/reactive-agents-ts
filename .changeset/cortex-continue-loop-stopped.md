---
"@reactive-agents/cortex": minor
---

Cortex can continue a run a loop guard stopped. A chat turn that ended on a loop guard shows a "Stopped by a loop guard" card under the thread with the reason in plain words, the tool it kept repeating, the tools already done and the items left; an optional note and a step grant (default 10 more) go with **Continue**, which calls the framework's `agent.resumeRun` and lands the reply as the next exchange. The Runs page lists loop-stopped durable desk runs with the same card. New routes: `GET /api/chat/sessions/:id/resumable`, `POST /api/chat/sessions/:id/resume/:runId`, `GET /api/loop-stopped-runs`, `POST /api/loop-stopped-runs/:runId/resume`. A run that cannot be continued (not loop-stopped, already continued, agent setup changed) answers 409 in plain wording, and a second Continue of a run that is still going is refused.

Continue needs the agent's existing **Durable execution** setting (Lab · Execution); it is off by default and Cortex adds no default or second toggle. With it on, approvals and questions pause the run durably instead of waiting live (a framework limit). A loop-stopped chat turn with it off shows a short hint to turn it on.
