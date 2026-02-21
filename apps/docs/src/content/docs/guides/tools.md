---
title: Tools
description: Giving agents the ability to act in the world.
---

The tools layer lets agents call external functions, APIs, and MCP servers.

## Registering Tools

Tools are defined with a schema and a handler:

```typescript
import { Effect } from "effect";

// Tool definitions follow the function-calling format
const searchTool = {
  name: "web_search",
  description: "Search the web for information",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", description: "Max results to return" },
    },
    required: ["query"],
  },
};
```

## Sandboxed Execution

All tool execution runs in a sandbox with:
- **Timeout** — Default 30s per tool call
- **Error containment** — Tool failures don't crash the agent
- **Result wrapping** — All outputs are wrapped in `ToolExecutionResult`

## Input Validation

Tool inputs are validated against their parameter schemas before execution:
- Required parameter checking
- Type validation (string, number, boolean, array, object)
- Enum validation
- Default value injection for optional parameters

## MCP Support

Connect to Model Context Protocol servers using the `makeMCPClient` factory.

**stdio transport** is fully implemented using `Bun.spawn()`. The client opens a subprocess, runs a background stdout reader loop for line-delimited JSON-RPC, performs the MCP `initialize` handshake, discovers tools via `tools/list`, and dispatches `tools/call` requests with Promise-based resolution. The subprocess is killed on `disconnect()`.

```typescript
import { makeMCPClient } from "@reactive-agents/tools";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const client = yield* makeMCPClient;

  // Connect to a local stdio MCP server
  const server = yield* client.connect({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  });

  const result = yield* client.callTool("filesystem", "read_file", {
    path: "/tmp/notes.txt",
  });

  yield* client.disconnect("filesystem");
  return result;
});
```

**SSE (HTTP event stream)** and **WebSocket** transports are stubbed — these will be implemented in a future release.

## Function Adapter

Convert plain functions into tool definitions:

```typescript
import { adaptFunction } from "@reactive-agents/tools";

const tool = adaptFunction({
  name: "calculate",
  description: "Perform arithmetic",
  fn: ({ a, b, op }) => {
    switch (op) {
      case "add": return a + b;
      case "sub": return a - b;
      case "mul": return a * b;
      case "div": return a / b;
    }
  },
  parameters: {
    a: { type: "number", description: "First operand" },
    b: { type: "number", description: "Second operand" },
    op: { type: "string", enum: ["add", "sub", "mul", "div"] },
  },
});
```
