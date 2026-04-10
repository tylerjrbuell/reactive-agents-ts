---
name: tool-creation
description: Create custom tools with defineTool() or tool(), register them with the agent, and configure required-tools gates and per-tool call budgets.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Tool Creation

## Agent objective

Produce a `ToolDefinition` object + handler, registered with the builder via `.withTools({ tools: [...] })`. Every field in the definition must be present and typed correctly.

## When to load this skill

- Adding a custom tool (API call, database query, file operation, etc.)
- Restricting which built-in tools an agent can use
- Forcing the agent to call a specific tool before completing
- Setting per-tool approval requirements or risk levels

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";
import { tool } from "@reactive-agents/tools";  // simple factory — no Effect knowledge needed

const lookupUser = tool("lookup-user", "Look up a user record by ID", async (args) => {
  const { userId } = args as { userId: string };
  const user = await db.findUser(userId);
  return { id: user.id, name: user.name, email: user.email };
});

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({
    tools: [lookupUser],
    allowedTools: ["lookup-user", "checkpoint"],  // restrict to only these
  })
  .withRequiredTools({ tools: ["lookup-user"], maxRetries: 2 })
  .build();
```

## Key patterns

### Two tool factories

```ts
// Factory 1: tool() — simple async, no Effect knowledge needed
import { tool } from "@reactive-agents/tools";

const myTool = tool("my-tool", "Description of what the tool does", async (args) => {
  const { param } = args as { param: string };
  return { result: await doSomething(param) };
});

// Factory 2: defineTool() — Effect-native, Schema-inferred typed args
import { defineTool } from "@reactive-agents/tools";
import { Schema } from "effect";

const myTool = defineTool({
  name: "my-tool",
  description: "Description of what the tool does",
  parameters: Schema.Struct({ param: Schema.String }),
  handler: ({ param }) =>
    Effect.tryPromise(() => doSomething(param)),
});
```

### Full ToolDefinition shape (when using low-level API)

```ts
import type { ToolDefinition } from "@reactive-agents/tools";

const myTool: ToolDefinition = {
  name: "send-email",          // unique identifier — no spaces
  description: "Send an email to a recipient",
  parameters: [
    { name: "to", type: "string", description: "Recipient email", required: true },
    { name: "subject", type: "string", description: "Email subject", required: true },
    { name: "body", type: "string", description: "Email body text", required: false },
  ],
  returnType: "object",        // "string" | "object" | "array" | "boolean" | "number"
  riskLevel: "medium",         // "low" | "medium" | "high" | "critical"
  timeoutMs: 10_000,           // default varies — set explicitly for network tools
  requiresApproval: false,     // true = agent pauses for human approval before calling
  source: "function",          // "function" for custom tools (not "builtin" or "mcp")
  category: "http",            // "search"|"file"|"code"|"http"|"data"|"custom"|"system"
  isCacheable: false,          // optional — enable for idempotent tools
  cacheTtlMs: 60_000,          // optional — cache duration
};
```

### Built-in tools available

Enable selectively with `allowedTools`:

**Standard tools** (enabled by `.withTools()` with no args):
`web-search`, `http-get`, `file-read`, `file-write`, `code-execute`

**Meta-tools** (registered by kernel, available in `.withTools()`):
`checkpoint`, `recall`, `find`, `brief`, `pulse`, `context-status`, `task-complete`, `final-answer`

**Opt-in tools** (not auto-enabled — must be registered manually):
`shell-execute` — see `shell-execution-sandbox` skill for registration pattern

```ts
// Only allow read-only tools
.withTools({ allowedTools: ["web-search", "http-get", "file-read", "checkpoint"] })

// Add custom tools alongside built-ins
.withTools({
  tools: [myCustomTool],
  allowedTools: ["web-search", "my-custom-tool"],
})
```

### Requiring tool calls before completion

```ts
// Agent must call web-search before final-answer is accepted
.withRequiredTools({ tools: ["web-search"], maxRetries: 3 })

// Framework decides which tools are required based on task content
.withRequiredTools({ adaptive: true })
```

## Builder API reference

| Method | Key params | Notes |
|--------|-----------|-------|
| `.withTools(opts?)` | `{ tools?, allowedTools?, adaptive?, resultCompression? }` | No args = all built-ins |
| `.withRequiredTools(cfg)` | `{ tools?: string[], adaptive?: boolean, maxRetries?: number }` | Forces tool calls |

## Pitfalls

- Tool `name` must be unique — registering a tool with a name that matches a built-in silently overrides the built-in
- `timeoutMs` default is often too short for network/API tools — always set it explicitly
- `withRequiredTools` without `withTools` does nothing — tools must be enabled first
- `source: "builtin"` is reserved for internal tools; use `"function"` for all custom tools
- `defineTool()` handlers must return `Effect<unknown, ToolExecutionError>` — wrap non-Effect async code with `Effect.tryPromise()`
- `requiresApproval: true` on a tool pauses execution until a human responds — requires an approval callback configured elsewhere
