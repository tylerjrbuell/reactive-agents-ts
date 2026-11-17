---
"@reactive-agents/cortex": minor
---

The chat plan card can run an edited plan in a strategy. An **Execute strategy** picker (Auto, Blueprint, Plan-execute-reflect) next to Execute runs the plan through the framework's `agent.execute(plan, { strategy })`; the reply lands in the thread and the card shows each step's final status. Each step has a folded **Dependencies and args** editor (the steps it waits for, and a JSON object of tool arguments) that is checked with the framework's dependency rules and saved with the plan, so Export and Import carry them. When the framework refuses a plan, its reason shows under the card. New route `POST /api/chat/sessions/:id/plan/execute`; `PUT .../plan` steps accept `dependsOn` and `args`.
