# @reactive-agents/tools

> Version: **0.10.3** — tool system for [Reactive Agents](https://docs.reactiveagents.dev/).

A type-safe tool registry, sandboxed execution (process + Docker), an MCP (Model Context Protocol)
client, native + text-parse function-calling drivers, the **healing pipeline** that recovers
malformed tool calls, the **Conductor's Suite** of meta-tools, and a full RAG pipeline (chunk →
load → ingest → search).

## Installation

```bash
bun add @reactive-agents/tools
```

## What this package provides

- **`ToolBuilder`** — fluent API for declaring tools.
- **`defineTool` / `tool`** — schema-inferred and minimal tool wrappers.
- **`ToolService` / `makeToolRegistry`** — Effect service + registry.
- **Sandboxes** — `makeSandbox` (in-process) and `makeDockerSandbox` (rootless Docker with
  seccomp) for code-execution tools.
- **MCP client** — connect over stdio (Bun.spawn) to any MCP server; SSE/WebSocket transports
  are stubbed.
- **Tool-calling drivers** — `NativeFCDriver` and `TextParseDriver` covering all providers.
- **Healing pipeline** — 4-stage repair (tool-name → param-name → path → type coercion).
- **Conductor's Suite** — meta-tools the kernel uses to run itself: `find`, `recall`, `brief`,
  `pulse`, `checkpoint`, `task-complete`, `final-answer`, `context-status`, `discover-tools`.
- **Built-in skills** — web search, file I/O, HTTP, code execute, docker execute, shell execute,
  scratchpad, RAG ingest/search, skill activation.
- **Sub-agent adapters** — wrap an agent as a tool (`createAgentTool`), call remote agents
  (`createRemoteAgentTool`), or spawn sub-agents at runtime (`createSpawnAgentTool` /
  `createSpawnAgentsTool`).

## Quick example

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { Effect } from "effect";

// Built-in skills (web search, file I/O, HTTP, code execution, scratchpad) are auto-registered.
const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning()
  .withTools()
  .build();

// Or register custom tools at build time:
const agentWithCustomTools = await ReactiveAgents.create()
  .withName("custom-agent")
  .withProvider("anthropic")
  .withTools({
    tools: [
      {
        definition: {
          name: "lookup",
          description: "Look up a value in the database",
          parameters: [
            { name: "key", type: "string", description: "Lookup key", required: true },
          ],
          riskLevel: "low",
          timeoutMs: 5_000,
          requiresApproval: false,
          source: "function",
        },
        handler: (args) => Effect.succeed(`Value for ${args.key}`),
      },
    ],
  })
  .build();
```

## ToolBuilder

```typescript
import { ToolBuilder } from "@reactive-agents/tools";

const lookup = ToolBuilder.create("lookup")
  .description("Look up a value in the database")
  .param("key", "string", { description: "Lookup key", required: true })
  .riskLevel("low")
  .timeoutMs(5_000)
  .handler(async (args) => `Value for ${args.key}`)
  .build();
```

`defineTool` (schema-inferred) and `tool()` (minimal wrapper) are also available.

## Conductor's Suite (meta-tools)

The kernel uses these meta-tools to run itself; they are auto-registered when reasoning is
enabled and can be opted out via `withMetaTools(false)`.

| Meta-tool | Purpose |
|---|---|
| `find` | Discover registered tools by intent |
| `recall` | Retrieve past observations + memory hits |
| `brief` | Get a structured task brief (skills, entropy grade) |
| `pulse` | Lightweight progress / entropy snapshot |
| `checkpoint` | Persist intermediate state for resumption |
| `task-complete` | Declare task done (visibility-gated) |
| `final-answer` | Capture the canonical final answer |
| `context-status` | Inspect the current message window / curator state |
| `discover-tools` | Surface tools added at runtime |
| `activate-skill` / `get-skill-section` | Pull a skill into context on demand |
| `spawn-agent` / `spawn-agents` | Dynamically dispatch sub-agents (with `.withDynamicSubAgents()`) |

## Built-in capability tools

| Tool | Module |
|---|---|
| `web-search` | `webSearchTool` (Tavily / SerpAPI / custom provider) |
| `file-read` / `file-write` | `fileReadTool` / `fileWriteTool` |
| `http-get` | `httpGetTool` |
| `code-execute` | `codeExecuteTool` (in-process JS sandbox) |
| `docker-execute` | `dockerExecuteTool` (rootless Docker with seccomp) |
| `shell-execute` | `shellExecuteTool` (allowlist + blocklist; opt-in via `.withTerminalTools()`) |
| `scratchpad-read` / `scratchpad-write` | Per-run mutable workspace |
| `rag-ingest` / `rag-search` | RAG pipeline tools |

## Healing pipeline

When a model emits a malformed tool call, the healing pipeline attempts repair before failing:

```typescript
import { runHealingPipeline } from "@reactive-agents/tools";

const repaired = await runHealingPipeline({
  candidate,            // model-emitted ToolCall
  registry,             // available tools
  observed,             // observed alias frequencies
});
```

Stages: tool-name fuzzy match → param-name fuzzy match → path resolution → JSON-Schema type
coercion. Recovers ~87% of malformed calls in v0.10.x with negligible overhead.

## MCP client

Connect to any MCP-compatible tool server over stdio:

```typescript
import { makeMCPClient } from "@reactive-agents/tools";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const client = yield* makeMCPClient;

  yield* client.connect({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  });

  const result = yield* client.callTool("filesystem", "read_file", {
    path: "/tmp/example.txt",
  });

  yield* client.disconnect("filesystem");
  return result;
});
```

**Transports:** `stdio` is fully implemented (background reader loop, tracked pending requests,
clean teardown). `SSE` and `WebSocket` are stubbed.

## Sub-agents

Wrap another agent as a callable tool:

```typescript
import { createAgentTool, createSpawnAgentTool } from "@reactive-agents/tools";

const reviewerTool = createAgentTool({
  name: "code-reviewer",
  description: "Review TypeScript diffs",
  agent: reviewerAgent,
});
```

`createSpawnAgentTool` lets the parent agent dynamically dispatch sub-agents at runtime
(`.withDynamicSubAgents()` builder shortcut). Recursion depth and parent-context passthrough are
bounded (`MAX_RECURSION_DEPTH`, `MAX_PARENT_CONTEXT_CHARS`).

## RAG pipeline

```typescript
import {
  loadMarkdown,
  chunkByMarkdownSections,
  ragIngestTool,
  ragSearchTool,
} from "@reactive-agents/tools";

const docs = await loadMarkdown("./docs/handbook.md");
const chunks = chunkByMarkdownSections(docs, { maxTokens: 800 });
// Pass chunks through ragIngestTool → ragSearchTool, or via runtime `.withDocuments()`.
```

## Caching

`ToolResultCache` caches deterministic tool results within a run (and optionally across runs):

```typescript
import { ToolResultCacheLive } from "@reactive-agents/tools";
```

## Documentation

- Tools guide: [docs.reactiveagents.dev/guides/tools/](https://docs.reactiveagents.dev/guides/tools/)
- MCP integration: [docs.reactiveagents.dev/guides/mcp/](https://docs.reactiveagents.dev/guides/mcp/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/reasoning`](../reasoning/README.md),
  [`@reactive-agents/memory`](../memory/README.md).

## License

MIT
