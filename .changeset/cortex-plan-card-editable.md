---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": patch
---

Cortex chat renders the framework's plan. In Plan mode the reply is an editable checklist card (reword, reorder, remove, add steps, with each step's status and tool hint); Execute records the edited plan through `session.setPlan`, switches to Execute and sends the follow-up turn, and the plan is stored with the chat session (`GET`/`PUT /api/chat/sessions/:id/plan`). The executed plan keeps a read-only card with live step status. Plan mode turns the `todo` meta-tool on for the chat so the model records its plan itself. The run view's Events tab shows `PlanRecorded`, `PlanStepStatusChanged` and `ChatModeChanged`. `@reactive-agents/ui-core` exports the wire types `PlanWire`, `PlanStepWire`, `PlanRecordedWire`, `PlanStepStatusChangedWire` and `ChatModeChangedWire`.
