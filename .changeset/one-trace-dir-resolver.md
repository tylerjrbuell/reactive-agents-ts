---
"@reactive-agents/runtime": patch
---

The runtime resolves its default trace directory through `resolveTraceDir()` from `@reactive-agents/trace`, the same resolver the trace recorder writes with. Previously the two could disagree (for example under `NODE_ENV=test` with no `REACTIVE_AGENTS_TRACE_DIR`), so a trace file was written but `result.metadata.tracePath` / `runId` were missing. `.withObservability({ tracing: true })` with no `dir` now defaults to `~/.reactive-agents/traces` (or `REACTIVE_AGENTS_TRACE_DIR`) instead of a cwd-relative `.reactive-agents/traces`, matching the docs and where `rax diagnose` looks.
