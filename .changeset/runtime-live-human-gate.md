---
"@reactive-agents/runtime": minor
---

Tool approval no longer needs durable runs. `.withApprovalPolicy({ mode: "detach" })` used to fail `build()` without `.withDurableRuns()`. Now, on an agent without durable runs, a gated tool call waits in process until a person answers:

- `runStream()` emits `ApprovalRequested` (`runId`, `gateId`, `toolName`, `args`) at both densities and stays open; after `agent.approveRun(runId)` or `agent.denyRun(runId, reason)` the same run continues on the same stream.
- `approveRun` / `denyRun` answer a run waiting in this process first and resolve with that run's final result; otherwise they resume a durable pause as before.
- `listPendingApprovals()` lists live waits too, and works without durable runs.
- `run(task, { onApproval })` answers live waits as well (before, it only drove durable pauses).
- `stop()` while waiting denies the call; `terminate()` cancels the run.

Durable runs stay the backend for answers from another process or after a restart; agents that pair `detach` with `.withDurableRuns()` behave as before. `.withUserInteraction()` still requires durable runs. It now round-trips through `toConfig()` / `fromConfig()` as `userInteraction: true`.

Also: an abstained run no longer trains the reactive-intelligence strategy bandit. The bandit rewards the run outcome, and abstention counted as a failure, so an honest abstention scored as a loss for its strategy. Abstained runs now skip the learning-engine update (no bandit or calibration sample).
