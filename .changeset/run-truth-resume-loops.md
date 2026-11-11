---
"@reactive-agents/runtime": patch
---

Run events now tell the truth about resumed runs and loop counts.

- A resumed durable run (`resumeRun`, `approveRun`, `denyRun`, `respondToInteraction`) runs under the task id its checkpoint was captured under. Its `AgentStarted`, `AgentCompleted` and kernel events now carry that one id. Before, the lifecycle events used the durable run id while the kernel events used the original task id, so an observer never saw the original run end. The task id is the canonical id of a run's events; the durable `runId` names the stored run row. A `fork()` is a new run: it runs under its own id, and its kernel events now carry that id too.
- `AgentCompleted.totalIterations` counts kernel loops (the same numbering as `ReasoningIterationProgress.iteration`). Before, it counted reasoning steps, so a run with 8 loops could report 23.
