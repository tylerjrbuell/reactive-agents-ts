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

Connect to Model Context Protocol servers:

```typescript
// MCP integration is available through the ToolService
// Connect to MCP servers that provide tools dynamically
```

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
