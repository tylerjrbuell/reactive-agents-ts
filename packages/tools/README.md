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
import { defineTool } from "@reactive-agents/tools";
import { Schema } from "effect";

const searchTool = defineTool({
  name: "web_search",
  description: "Search the web for information",
  input: Schema.Struct({ query: Schema.String }),
  handler: ({ query }) => Effect.succeed(`Results for: ${query}`),
});

const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools([searchTool])
  .build();

const result = await agent.run("What are the latest AI developments?");
```

## MCP Client

```typescript
const agent = await ReactiveAgents.create()
  .withTools({ mcp: { url: "http://localhost:3000" } })
  .build();
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/tools/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/tools/)
