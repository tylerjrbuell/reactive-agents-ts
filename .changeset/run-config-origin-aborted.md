---
"@reactive-agents/core": patch
"@reactive-agents/runtime": patch
"@reactive-agents/trace": patch
---

Measurement-only trace fields: `run-started.config` now records the resolved harness configuration (`{ mechanisms, builder, env }`, secret-free and size-bounded) and `run-started.origin` records the caller (`user | gateway | cortex-chat | cortex-utility | subagent | scheduled | eval`; new optional `origin` option on `agent.run()` / `runStream()`). A run that ends by failure, crash or interrupt without `run-completed` now leaves a `run-aborted` sentinel (new core `AgentAborted` event, new trace kind). No behavior change.
