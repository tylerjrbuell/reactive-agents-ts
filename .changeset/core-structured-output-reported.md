---
"@reactive-agents/core": minor
---

Add `StructuredOutputReport` (with `StructuredOutputLayer`, `JsonRepairStep`, `NativeOutcome`, `StructuredFieldError`, `StructuredOutputFailureKind`) and a `StructuredOutputReported` AgentEvent (`{ taskId, strategy?, report, timestamp }`) so a structured-output extraction's provenance can reach traces, Cortex and calibration. `ToolCallStarted` gains an optional `args` field (post-heal arguments) so UIs can show a long-running tool call before it completes. Both changes are additive.
