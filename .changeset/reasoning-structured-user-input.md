---
"@reactive-agents/reasoning": minor
---

The kernel carries structured `request_user_input` questions end to end. `AskUserRequest` now has `questions` (always set; legacy `kind`/`prompt`/`schema` calls are normalized) and `structured`. For a call with `questions`, the kernel validates the request and the host's id-keyed answer map (live `askUser` rail or durable resume) and gives the model the typed answer JSON. A malformed request or invalid answers return a tool-result error and the run goes on, so the model can ask again; a timeout (`AskUserOutcome.timedOut`, or a reason containing "timed out") returns every question as `timeout`. Legacy single-question calls behave as before.
