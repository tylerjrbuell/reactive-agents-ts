---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

A blocked answer is never published. With `.withGuardrails()` or `.withBehavioralContracts()`, the reasoning kernel's `FinalAnswerProduced` event is now held until the final-output screen passes. Before, the event went out before the screen ran, so any event consumer (a UI, telemetry, `agent.subscribe`) received an answer the output guardrail then blocked, PII included. A blocked run fails with `GuardrailViolationError` as before and its held answer is dropped. On `runStream()` the `TextDelta` tokens are held the same way: they arrive just before `StreamCompleted` when the run succeeds and are never delivered when it is blocked. Runs without an output screen are unchanged.

Asking the user no longer needs durable runs. `.withUserInteraction()` builds without `.withDurableRuns()`: a `request_user_input` question then waits live in process. The stream shows `InteractionRequested`, `listPendingInteractions()` lists the question, and `respondToInteraction(runId, interactionId, value)` answers it; the same run continues with the answer. With `.withDurableRuns()` the run pauses durably as before.

Also in this release:

- `.withUserInteraction({ timeoutMs })` bounds a live question. With no answer in time the model reads `The user did not answer: no answer within <ms>ms` and the run continues. Round-trips through `toConfig()` as `userInteraction: { timeoutMs }`.
- `.withApprovalPolicy({ timeoutMs })` is enforced. A live `detach` wait or a `mode: "block"` `onApprove` callback that does not decide in time denies the call. `approvalPolicy.timeoutMs` is part of `AgentConfig`.
- `.withName()` now labels the run: `AgentStarted.agentDisplayName` is the builder name instead of the generated `<name>-<epoch>` id. Without a name the id is shown, as before.
