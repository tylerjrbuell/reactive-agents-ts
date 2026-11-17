# @reactive-agents/tools

> Tool registry, built-in tools, MCP client, sandboxed execution and tool-call healing for Reactive Agents.

> **Stability:** stable for `defineTool()` / `tool()` and the `.withTools()` surface. Sandboxes, drivers, the healing pipeline and the other exports may change between minors; see the [stability reference](https://docs.reactiveagents.dev/reference/stability/).

## Install

```bash
bun add @reactive-agents/tools
# or: npm install @reactive-agents/tools
```

The `reactive-agents` facade re-exports the builder that registers these tools (`bun add reactive-agents`).

## Usage

```ts
import { ReactiveAgents } from "reactive-agents";
import { defineTool } from "@reactive-agents/tools";
import { Schema } from "effect";

const lookup = defineTool({
  name: "lookup",
  description: "Look up a value by key",
  input: Schema.Struct({ key: Schema.String }),
  // args is typed from the schema
  handler: async (args) => `Value for ${args.key}`,
});

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ tools: [lookup] })
  .build();
```

`shell-execute` is opt-in: `.withTools({ terminal: true })`.

## API

| Export | Use it when |
|---|---|
| `defineTool`, `tool` | You author a custom tool (schema-validated, typed handler). |
| `ToolBuilder` | You prefer a fluent API for declaring a tool. |
| `ToolService`, `ToolServiceLive`, `makeToolRegistry` | You work with the tool registry as an Effect service. |
| `builtinTools`, `BUILTIN_TOOL_NAMES` | You list or select the built-in tools (web search, file I/O, HTTP, code and shell execution, scratchpad, RAG). |
| `makeMCPClient` | You connect to an MCP server directly (stdio, streamable-http, SSE, WebSocket). |
| `makeSandbox`, `makeDockerSandbox` | You run untrusted code in-process or in Docker. |
| `runHealingPipeline` | You repair malformed model tool calls (tool name, parameter names, paths, types). |
| `NativeFCDriver`, `TextParseDriver` | You parse tool calls from native function calling or from text. |
| `createAgentTool`, `createRemoteAgentTool`, `createSpawnAgentTool` | You expose an agent as a tool or spawn sub-agents. |
| `loadMarkdown`, `chunkByMarkdownSections`, `ragIngestTool` | You build a RAG ingest and search pipeline. |
| `ToolResultCache`, `ToolResultCacheLive` | You cache deterministic tool results. |

## Documentation

- [Tools guide](https://docs.reactiveagents.dev/guides/tools/): hub for the pages below
- [Built-in tools](https://docs.reactiveagents.dev/guides/tools/built-in-tools/)
- [Custom tools](https://docs.reactiveagents.dev/guides/tools/custom-tools/)
- [MCP tools](https://docs.reactiveagents.dev/guides/tools/mcp-tools/)
- [Scoping and policy](https://docs.reactiveagents.dev/guides/tools/scoping-and-policy/)
- [Execution and results](https://docs.reactiveagents.dev/guides/tools/execution-and-results/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
