---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

`toConfig()` followed by `agentConfigToBuilder()` now rebuilds the same agent, `features` included:

- A builder without `.withObservability()` no longer writes an `observability` block. Before, `toConfig()` wrote the default `{ verbosity: "minimal" }`, and reloading the config turned observability on.
- `.withReactiveIntelligence(false)` survives the round trip. Before, the reloaded agent had reactive intelligence back on.
- `reasoning` in `AgentConfig` now also carries `strategies`, `adaptive`, `parallelToolCalls` and `observationSummary`, the same shapes `.withReasoning()` takes.
