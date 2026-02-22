# @reactive-agents/tools

Tool system for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Provides a type-safe tool registry, sandboxed execution, and an MCP (Model Context Protocol) client.

## Installation

```bash
bun add @reactive-agents/tools effect
```

## Features

- **Tool registry** — register typed tools with Effect-TS schemas
- **Sandboxed execution** — tools run in isolation with timeout and resource limits
- **MCP client** — connect to any MCP-compatible tool server

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

// Built-in tools (web search, file I/O, HTTP, code execution) are auto-registered
const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()              // enable built-in tools
  .build();

// Or register custom tools at build time:
const agentWithCustomTools = await ReactiveAgents.create()
  .withName("custom-agent")
  .withProvider("anthropic")
  .withTools({
    tools: [{
      definition: {
        name: "lookup",
        description: "Look up a value in the database",
        parameters: [{ name: "key", type: "string", description: "Lookup key", required: true }],
        riskLevel: "low",
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function",
      },
      handler: (args) => Effect.succeed(`Value for ${args.key}`),
    }],
  })
  .build();

const result = await agent.run("What are the latest AI developments?");
```

## MCP Client

The MCP client supports connecting to local MCP servers over stdio using `Bun.spawn()`.

```typescript
import { makeMCPClient } from "@reactive-agents/tools";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const client = yield* makeMCPClient;

  // Connect to a local MCP server over stdio
  const server = yield* client.connect({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  });

  // Call a tool on the server
  const result = yield* client.callTool("filesystem", "read_file", {
    path: "/tmp/example.txt",
  });

  yield* client.disconnect("filesystem");
  return result;
});
```

**Transport support:**
- **stdio** — Fully implemented. Uses `Bun.spawn()` with a background stdout reader loop for line-delimited JSON-RPC. Handles the MCP `initialize` handshake, tool discovery via `tools/list`, and `tools/call` invocations. Pending requests are tracked with Promise-based resolution; the subprocess is killed on disconnect.
- **SSE (HTTP event stream)** — Stub, not yet implemented.
- **WebSocket** — Stub, not yet implemented.

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/tools/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/tools/)
