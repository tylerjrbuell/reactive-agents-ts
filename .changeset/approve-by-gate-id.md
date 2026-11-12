---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

`approveRun(runId, { gateId })` and `denyRun(runId, reason, { gateId })` answer exactly one waiting request. Parallel sub-agents ask under the root run id, so a person could not choose which one to approve; the oldest wait always took the decision. Without `gateId` behavior is unchanged, and the approval endpoint accepts `gateId` in its body. Sub-agent memory ids are now stable and parent-scoped (`sub-<parentAgentId>-<name>`) instead of embedding a timestamp, so repeat spawns reuse one memory store instead of creating a new folder each time; event and trace correlation ids stay unique.
