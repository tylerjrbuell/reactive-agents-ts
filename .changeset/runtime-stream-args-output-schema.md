---
"@reactive-agents/runtime": minor
"@reactive-agents/reactive-agents": minor
---

Streaming and structured output: `runStream` events carry tool-call arguments while a call runs (`ToolCallStarted.args`) and emit `StructuredOutputReported` with how a typed result was obtained (native, prompt, repaired, coerced, retried); `AgentConfig.outputSchema` accepts JSON Schema (checked by a dependency-free subset validator that rejects unsupported keywords at build time); `runStream(task, { outputSchema })` applies a per-turn schema; `result.objectReport` and `StreamCompleted` carry the object, error and report.
