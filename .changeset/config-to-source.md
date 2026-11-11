---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

New `agentConfigToSource(config, options?)` prints the `ReactiveAgents.create()…build()` TypeScript for an `AgentConfig` ("config as code"). Secrets never appear in the output: MCP `env` and `headers` values and `apiKey` / `secret` / `password` strings print as `process.env.X` references. New `agentConfigToBuilderCalls(config)` returns the ordered `{ method, args }` builder calls for a config. `agentConfigToBuilder()` now applies exactly that list, so the printed code and `ReactiveAgents.fromConfig()` build the same agent.
