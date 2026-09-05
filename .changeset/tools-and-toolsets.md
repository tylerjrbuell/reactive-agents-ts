---
"@reactive-agents/tools": minor
"@reactive-agents/runtime": minor
"@reactive-agents/a2a": patch
---

Add a `grep` builtin tool and named toolset alias shortcuts (`defineToolset`), both opt-in. Add a `relate` tool for the memory graph, give `find` real memory-entry ids, and fix a second FTS5 crash site plus four dead field-name branches in tool-result compression.

Add a small tool-authoring toolkit for custom tools: `fetchJsonTool` (standard HTTP adapter with retry and empty-result handling), `boundedMap` (concurrency-capped fan-out), `searchThenFetch`/`resolveThenRetrieve` (research orchestration primitives), `withToolObservability`/`withToolRetry` (envelope helpers), and `testTool`/`mockFetchOnce` (turnkey test helpers). `defineTool` now accepts an output schema, validated at runtime. Fix MCP client connection state being isolated per-process instead of per-instance, which could cross-contaminate state across multiple MCP clients in the same process. Fix `codeExecuteHandler` to accept `config.sandbox` like its sibling handlers, and factory-shape the config surface for the `http-get` tool and A2A egress guards for consistency with the rest of the tool config API.
