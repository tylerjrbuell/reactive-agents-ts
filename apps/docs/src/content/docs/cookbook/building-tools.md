---
title: Building Custom Tools
description: >-
  Create typed, validated tools with the fluent ToolBuilder API or plain
  ToolDefinition objects.
sidebar:
  order: 8
---

Tools give agents the ability to take real-world actions — fetch data, run code, call APIs, write files. This recipe covers both the fluent `ToolBuilder` API and the lower-level `ToolDefinition` format.

## ToolBuilder (Recommended)

The fluent `ToolBuilder` builds the tool *definition* — name, description, typed parameters, risk metadata — and catches misconfiguration at build time (a missing description throws). The execution handler is supplied when you register the tool with `.withTools({ tools })`: it receives a single `args` record and returns an `Effect`.

```typescript
import { ReactiveAgents } from "reactive-agents";
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

const { definition } = ToolBuilder.create("web-search")
  .description("Search the web for current information")
  .param("query", "string", "The search query", { required: true })
  .param("maxResults", "number", "Max results to return", { default: 5 })
  .riskLevel("low")
  .timeout(15_000)
  .returnType("SearchResult[]")
  .category("search")
  .build();

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    tools: [
      {
        definition,
        handler: (args) =>
          Effect.tryPromise(async () => {
            const query = String(args.query);
            const maxResults = Number(args.maxResults ?? 5);
            // your implementation
            return { query, maxResults, results: [] };
          }),
      },
    ],
  })
  .build();
```

Use `Effect.succeed(...)` for pure values, `Effect.try(...)` for synchronous code that can throw, and `Effect.tryPromise(...)` for async work — errors are surfaced to the agent as observations instead of crashing the run.

For a fully *typed* handler (validated args inferred from a schema, plain `async` functions allowed), use [`defineTool`](/guides/tools/#registering-custom-tools) — its result is directly assignable to the `tools` array.

## Parameter Types

<!-- docs-skip-typecheck -->
```typescript
new ToolBuilder("file-processor")
  .description("Process a file")
  .param("path", "string", "Absolute file path", { required: true })
  .param("encoding", "string", "File encoding", {
    default: "utf-8",
    enum: ["utf-8", "ascii", "base64"],   // restricts LLM to these values
  })
  .param("maxBytes", "number", "Maximum bytes to read")
  .param("lines", "array", "Specific line numbers to extract")
  .param("options", "object", "Advanced options")
  .build();
```

## Risk Levels and Approval Gates

<!-- docs-skip-typecheck -->
```typescript
const deleteFileTool = new ToolBuilder("delete-file")
  .description("Permanently delete a file from disk")
  .param("path", "string", "File path to delete", { required: true })
  .riskLevel("high")           // "low" | "medium" | "high" | "critical"
  .requiresApproval()          // sets definition.requiresApproval = true
  .timeout(5_000)
  .build();
```

`requiresApproval()` stores a boolean flag on the `ToolDefinition`. The flag is metadata — it does **not** by itself pause agent execution.

To have the **framework** pause a run on a gated call and resume it on approval, use [Durable Human-in-the-Loop](/guides/durable-hitl/): name the tool in `.withApprovalPolicy({ tools: ["delete-file"], mode: "detach" })` (with `.withDurableRuns()`). The run returns `status: "awaiting-approval"` and you call `agent.approveRun(runId)` / `denyRun(runId, reason)` — from any process. The manual pattern below is for when you want to gate execution in your own pipeline without durable runs.

The flag is visible in `listTools()` output and on the definition returned by `build()`, so you can check it in a custom execution pipeline:

<!-- docs-skip-typecheck -->
```typescript
// Example: check the flag before passing a tool to ToolService
const { definition, handler } = new ToolBuilder("delete-file")
  .description("Permanently delete a file from disk")
  .param("path", "string", "File path to delete", { required: true })
  .riskLevel("high")
  .requiresApproval()
  .build();

if (definition.requiresApproval) {
  const approved = await askUser(`Approve execution of "${definition.name}"?`);
  if (!approved) throw new Error("User denied approval");
}
// proceed to register / execute
```

## Tool Categories

Categories help the agent reason about which tools to use:

<!-- docs-skip-typecheck -->
```typescript
new ToolBuilder("fetch-status-page")
  .description("Fetch the service status page")
  .category("http")   // "search" | "file" | "code" | "http" | "data" | "system" | "custom" | "vcs" | "productivity"
  .build();
```

## Low-Level ToolDefinition

For integrating with existing tool registries or when you need full control:

```typescript
import type { ToolDefinition } from "@reactive-agents/tools";

const calculator: ToolDefinition = {
  name: "calculator",
  description: "Evaluate a mathematical expression",
  parameters: [
    {
      name: "expression",
      type: "string",
      description: "Math expression to evaluate (e.g., '2 + 2 * 3')",
      required: true,
    },
  ],
  riskLevel: "low",
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function",
  returnType: "number",
};
```

## Tools with Side Effects

For tools that modify state, raise the `riskLevel` and return structured results so the agent can reason about success/failure:

```typescript
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

const { definition: writeFileDef } = ToolBuilder.create("write-file")
  .description("Write content to a file, creating it if it doesn't exist")
  .param("path", "string", "Destination file path", { required: true })
  .param("content", "string", "Content to write", { required: true })
  .param("append", "boolean", "Append instead of overwrite", { default: false })
  .riskLevel("medium")
  .timeout(10_000)
  .build();

const writeFileHandler = (args: Record<string, unknown>) =>
  Effect.tryPromise(async () => {
    const path = String(args.path);
    const content = String(args.content);
    const { writeFile, appendFile } = await import("fs/promises");
    const fn = args.append ? appendFile : writeFile;
    await fn(path, content, "utf-8");
    return { success: true, path, bytesWritten: content.length };
  });

// Register with .withTools({ tools: [{ definition: writeFileDef, handler: writeFileHandler }] })
```

## Restricting Available Tools

Give the agent a focused set of tools for a specific task — prevents distraction and reduces token usage:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    allowedTools: ["web-search", "file-read"],  // LLM only sees these
  })
  .build();
```

## Tool Result Compression

Large tool outputs (e.g., full file contents, long API responses) are automatically compressed to fit the context window. Configure the compression behavior:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    resultCompression: {
      budget: 2_000,            // chars before overflow triggers compression
      previewItems: 3,          // array items shown in the preview
      autoStore: true,          // stash overflow in the scratchpad for recall
    },
  })
  .build();
```

## MCP Tools

Connect to any Model Context Protocol server to get its tools automatically:

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

The agent discovers and uses all tools advertised by the MCP server.
