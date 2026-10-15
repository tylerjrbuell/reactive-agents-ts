---
"@reactive-agents/runtime": patch
---

W0.5 result→trace linkage (Lift Protocol plumbing): every `agent.run()` result now carries `metadata.runId` (the ULID trace run id, equal to the engine `taskId`) and `metadata.tracePath` (absolute `<traceDir>/<runId>.jsonl`) when tracing recorded the run. The pair is minted at the single execution-engine finalize seam after a settle-flush of the run's buffered trace events, and is emitted ONLY when the file is verified to exist: disabled tracing yields honest absence, never a phantom path. Consumers (`rax diagnose replay <tracePath>`, per-wave Lift captures) no longer need directory-mtime guessing to find a run's trace.
