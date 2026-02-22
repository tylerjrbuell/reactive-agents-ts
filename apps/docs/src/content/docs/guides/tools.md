---
title: Tools
description: Giving agents the ability to act in the world — tool registry, sandbox execution, MCP, and reasoning integration.
sidebar:
  order: 8
---

The tools layer lets agents call external functions, APIs, and MCP servers. Tools integrate directly with the reasoning loop — when an agent thinks it needs information or wants to take an action, it calls a tool and uses the real result.

## Built-in Tools vs Custom Tools

When you call `.withTools()`, several built-in tools are automatically registered. You can also register custom tools at build time by passing options.

### Using Built-in Tools

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools()               // Built-in tools auto-registered
  .withReasoning()           // Tools work with or without reasoning
  .build();

const result = await agent.run("What is the population of Tokyo times 3?");
```

### Registering Custom Tools

Pass custom tool definitions via the `tools` option:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    tools: [{
      definition: {
        name: "calculator",
        description: "Perform arithmetic calculations",
        parameters: [{ name: "expression", type: "string", description: "Math expression", required: true }],
        riskLevel: "low",
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function",
      },
      handler: (args) => Effect.try(() => String(eval(String(args.expression)))),
    }],
  })
  .withReasoning()
  .build();
```

You can also register tools programmatically after build using `ToolService.register()` via the Effect API.

### With Reasoning (ReAct)

When reasoning is enabled, the agent uses a Think → Act → Observe loop. The LLM can request tool calls by emitting `ACTION: tool_name({"param": "value"})` in its response. The framework:

1. Parses the action from the LLM output
2. Validates input against the tool's schema
3. Executes the tool in a sandbox
4. Returns the real result as an Observation
5. The LLM continues reasoning with the new information

### Without Reasoning (Direct LLM Loop)

Without reasoning, tool calling uses the LLM provider's native function calling:

1. Tool definitions are converted to the provider's format (Anthropic tools, OpenAI function_calling, Gemini function declarations)
2. When the LLM responds with `stopReason: "tool_use"`, the framework executes the requested tools
3. Results are appended to the message history as tool results
4. The LLM is called again with the updated context
5. Loop continues until the LLM stops requesting tools

Both paths produce the same outcome — the agent uses tools to accomplish its task.

## Built-in Tools

When you enable `.withTools()`, these tools are automatically registered and available to the agent:

| Tool | Category | Description | Requires |
|------|----------|-------------|----------|
| `web-search` | search | Search the web using Tavily API | `TAVILY_API_KEY` |
| `http-get` | http | Make HTTP GET requests | — |
| `file-read` | file | Read file contents (path-traversal protected) | — |
| `file-write` | file | Write file contents (requires approval) | — |
| `code-execute` | code | Execute code snippets (stub — sandbox only) | — |

### Web Search Configuration

The `web-search` tool requires a [Tavily](https://tavily.com) API key. Without it, calls to `web-search` return an error telling the agent the tool is inactive:

```bash
# .env
TAVILY_API_KEY=tvly-...
```

When the key is set, web search makes real API calls and returns `{ title, url, content }` results. When missing, the agent sees an explicit error message explaining that `TAVILY_API_KEY` is not configured.

## Sandboxed Execution

All tool execution runs in a sandbox with:

- **Timeout** — Default 30s per tool call, configurable
- **Error containment** — Tool failures don't crash the agent; errors are reported as observation text
- **Result wrapping** — All outputs are wrapped in `ToolExecutionResult` with success/failure status

## Input Validation

Tool inputs are validated against their schemas before execution:

- Required parameter checking
- Type validation (string, number, boolean, array, object)
- Enum validation
- Default value injection for optional parameters

Invalid inputs are rejected before the tool handler runs.

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

## MCP Support

Connect to [Model Context Protocol](https://modelcontextprotocol.io) servers for external tool discovery and execution.

### stdio Transport

Fully implemented — launches a subprocess and communicates via JSON-RPC over stdin/stdout:

```typescript
import { makeMCPClient } from "@reactive-agents/tools";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const client = yield* makeMCPClient;

  // Connect to a local stdio MCP server
  yield* client.connect({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  });

  // Discover tools
  const tools = yield* client.listTools("filesystem");

  // Call a tool
  const result = yield* client.callTool("filesystem", "read_file", {
    path: "/tmp/notes.txt",
  });

  // Disconnect
  yield* client.disconnect("filesystem");
  return result;
});
```

### Builder Integration

Connect MCP servers through the builder API — no manual client setup needed:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  })
  .build();
```

Or load from a config file with the CLI:

```bash
# .rax/mcp.json (auto-loaded if present)
{
  "servers": [
    { "name": "fs", "transport": "stdio", "command": "npx", "args": ["-y", "@anthropic/mcp-filesystem"] }
  ]
}

# Explicit path
rax run "list files" --mcp-config .rax/mcp.json
```

### SSE and WebSocket Transports

SSE (HTTP event stream) and WebSocket transports are stubbed for future implementation.

## Tool Type Conversion

The framework automatically converts between the tools package format and the LLM provider's native format using `toFunctionCallingFormat()`:

```typescript
// Internal: tools package format
{ name: "search", description: "...", parameters: [...] }

// Converted to: LLM provider format
{ name: "search", description: "...", inputSchema: { type: "object", properties: {...} } }
```

This conversion happens automatically in the execution engine — you don't need to worry about format differences between providers.

## Memory Integration

When tools are executed during reasoning, the results are automatically logged as episodic memories:

```typescript
// This happens automatically when both .withTools() and .withMemory() are enabled
// Each tool result is logged with:
// - Action taken
// - Tool name and input
// - Result content
// - Timestamp
```

This means the agent can recall past tool results in future sessions.
