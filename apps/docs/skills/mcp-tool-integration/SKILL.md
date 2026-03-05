---
name: mcp-tool-integration
description: Integrate MCP servers as agent tools for filesystem, GitHub, and external-system workflows.
compatibility: Reactive Agents projects using .withMCP() and .withTools().
metadata:
  author: reactive-agents
  version: "1.0"
---

# MCP Tool Integration

Use this skill when building specialized agents that need external capabilities through MCP servers.

## Agent objective

When an agent implements MCP integration, it should:

- Enable tools first, then bind MCP server definitions explicitly.
- Keep MCP scope minimal to the required capability surface.
- Ensure lifecycle-safe behavior for long-running transports.

## What this skill does

- Connects MCP servers via stdio and transport config.
- Exposes MCP toolsets to reasoning strategies through `.withTools()`.
- Applies safe lifecycle patterns so transports are disposed and cleaned up.

## Accurate builder patterns

```ts
const agent = await ReactiveAgents.create()
  .withName("mcp-filesystem-agent")
  .withProvider("anthropic")
  .withTools()
  .withMCP([
    {
      name: "filesystem",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
  ])
  .build();
```

## Use cases

- File-aware coding agents using MCP filesystem tools.
- Repo automation agents with GitHub MCP tools.
- Messaging/workflow agents combining MCP tools with gateway scheduling.

## Code Examples

### Filesystem Agent

This example demonstrates how to connect an agent to an MCP filesystem server. The agent can then use tools like `filesystem.readFile` and `filesystem.listFiles` to interact with the local filesystem.

The `withMCP` method takes an array of server configurations. Here, we define a `filesystem` server that uses the `stdio` transport and is launched using `bunx`.

*Source: [apps/examples/src/tools/06-mcp-filesystem.ts](apps/examples/src/tools/06-mcp-filesystem.ts)*

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// ...

const agent = await ReactiveAgents.create()
  .withName("mcp-filesystem-agent")
  .withProvider("anthropic")
  .withTools()
  .withMCP([{
    name: "filesystem",
    transport: "stdio",
    command: "bunx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  }])
  .withMaxIterations(10)
  .build();

const result = await agent.run("What files or directories are available? Give a brief summary.");
```

## Expected implementation output

- A builder chain with `.withTools()` + `.withMCP([...])` using concrete server config.
- Safe process behavior (cleanup/disposal assumptions documented for runtime context).
- A small, testable prompt/task showing MCP tool invocation flow.

## Pitfalls to avoid

- Enabling MCP without `.withTools()`.
- Forgetting to dispose long-running agent processes.
- Running untrusted MCP commands without sandbox constraints.
