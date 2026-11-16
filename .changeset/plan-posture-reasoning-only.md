---
"@reactive-agents/reasoning": minor
---

Plan posture is now a pure reasoning mode: the run offers no tools at all (every call, `todo` and exit tools included, is blocked and recorded), the model may think and reason freely, and the run completes when it replies with its plan. The single guidance line now says plan mode, no tools, give the plan, the user switches to execute mode to carry it out. The `posture-applied` trace signal no longer carries `planRecorded`. Execute and absent posture are unchanged.
