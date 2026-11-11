---
"@reactive-agents/reasoning": patch
---

Asking the user no longer needs durable runs. `RunEnvelope.rails.askUser` is a new optional rail. When a host sets it, a `request_user_input` call is answered inline: the kernel calls the rail and puts the answer in the call's tool result (`The user responded: ...`), and the run keeps going. When nobody answers, the tool result says so (`The user did not answer: <reason>`). Without the rail, the run still pauses with `awaiting-interaction` as before. New exported types: `AskUserRail`, `AskUserRequest`, `AskUserOutcome`, `UserInteractionKind`.

Also in this release:

- `.withApprovalPolicy()` accepts `timeoutMs`. The in-process approval decider receives it as `timeoutMs` (new `PendingApproval` type). Unset means no change in behaviour.
- `ToolCallStarted` events now carry `args`, the call's arguments after healing, so a UI can show a running call before it completes.
- Every `extractStructuredOutput()` call publishes one `StructuredOutputReported` event with its provenance report, on success and on extraction failure. The report types now come from `@reactive-agents/core` and are re-exported unchanged.
