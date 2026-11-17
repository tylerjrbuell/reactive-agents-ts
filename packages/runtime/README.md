# @reactive-agents/runtime

> The execution engine and fluent builder behind Reactive Agents: assemble an agent from opt-in layers and run it through a hookable 12-phase lifecycle.

> **Stability:** stable. `ReactiveAgents.create()` and the `.with*()` chain are tier-1 stable; individual newer withers carry their own `@unstable` or `@experimental` tags.

## Install

```bash
bun add @reactive-agents/runtime
# or: npm install @reactive-agents/runtime
```

Most projects install the facade instead (`bun add reactive-agents`), which re-exports this package with the other core layers.

## Usage

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning()
  .build();

const result = await agent.run("Explain the CAP theorem");
console.log(result.output);
```

Build with `.build()` (Promise) or `.buildEffect()` (Effect), then call `agent.run()` or `agent.runEffect()`. Stream events with `agent.runStream()`.

## API

| Export | Use it when |
|---|---|
| `ReactiveAgents`, `ReactiveAgentBuilder` | You assemble an agent with the `.with*()` chain |
| `ExecutionEngine` | You need the 12-phase lifecycle (`bootstrap` through `complete`) and its `before`/`after`/`on-error` hooks via `.withHook()` |
| `createRuntime()`, `createLightRuntime()` | You embed the runtime in a larger Effect program |
| `AgentStream`, `StreamDensity` | You consume streaming events |
| `AgentSession`, `directChat()` | You hold stateful or stateless chat sessions |
| `agentFn`, `pipe`, `parallel`, `race` | You compose agents functionally |
| `synthesizeDebrief()` | You summarize a finished run (cost, tools, verdict) |
| `ingestDocuments()` | You ingest documents for retrieval |

The full list of builder methods is in the builder reference, not here.

## Documentation

- [Builder API reference](https://docs.reactiveagents.dev/reference/builder-api/)
- [Lifecycle hooks](https://docs.reactiveagents.dev/guides/hooks/)
- [Streaming](https://docs.reactiveagents.dev/features/streaming/)
- [Gateway and channels](https://docs.reactiveagents.dev/features/gateway/)
- [Durable execution](https://docs.reactiveagents.dev/guides/durable-execution/)
- [Architecture](https://docs.reactiveagents.dev/concepts/architecture/)

## Related packages

- [`@reactive-agents/reasoning`](https://www.npmjs.com/package/@reactive-agents/reasoning)
- [`@reactive-agents/llm-provider`](https://www.npmjs.com/package/@reactive-agents/llm-provider)
- [`@reactive-agents/tools`](https://www.npmjs.com/package/@reactive-agents/tools)
- [`@reactive-agents/memory`](https://www.npmjs.com/package/@reactive-agents/memory)
- [`@reactive-agents/gateway`](https://www.npmjs.com/package/@reactive-agents/gateway)
- [`@reactive-agents/channels`](https://www.npmjs.com/package/@reactive-agents/channels)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+. Memory is SQLite-backed; FTS5 is absent on Node and search falls back to `LIKE`.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
