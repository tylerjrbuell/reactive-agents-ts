---
title: Building Custom Tools
description: Create typed, validated tools with the fluent ToolBuilder API or plain ToolDefinition objects.
sidebar:
  order: 6
---

Tools give agents the ability to take real-world actions — fetch data, run code, call APIs, write files. This recipe covers both the fluent `ToolBuilder` API and the lower-level `ToolDefinition` format.

## ToolBuilder (Recommended)

The fluent `ToolBuilder` catches misconfiguration at build time:

```typescript
import { ToolBuilder } from "@reactive-agents/tools";

const searchTool = new ToolBuilder("web-search")
  .description("Search the web for current information")
  .param("query", "string", "The search query", { required: true })
  .param("maxResults", "number", "Max results to return", { default: 5 })
  .riskLevel("low")
  .timeout(15_000)
  .returnType("SearchResult[]")
  .category("search")
  .handler(async (query: string, maxResults: number = 5) => {
    // your implementation
    return { results: [] };
  })
  .build();
```

Register it on the agent:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ tools: [searchTool.definition] })
  .build();
```

## Parameter Types

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

```typescript
const deleteFileTool = new ToolBuilder("delete-file")
  .description("Permanently delete a file from disk")
  .param("path", "string", "File path to delete", { required: true })
  .riskLevel("high")           // "low" | "medium" | "high" | "critical"
  .requiresApproval()          // pauses agent and asks user before executing
  .timeout(5_000)
  .build();
```

With `requiresApproval()`, the agent pauses before executing and resumes once the user approves via `.resume()`.

## Tool Categories

Categories help the agent reason about which tools to use:

```typescript
new ToolBuilder("send-email")
  .description("Send an email message")
  .category("communication")   // "search" | "file" | "code" | "communication" | "data" | "compute"
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

For tools that modify state, use `riskLevel("high")` and return structured results so the agent can reason about success/failure:

```typescript
const writeFileTool = new ToolBuilder("write-file")
  .description("Write content to a file, creating it if it doesn't exist")
  .param("path", "string", "Destination file path", { required: true })
  .param("content", "string", "Content to write", { required: true })
  .param("append", "boolean", "Append instead of overwrite", { default: false })
  .riskLevel("medium")
  .timeout(10_000)
  .handler(async (path: string, content: string, append = false) => {
    const { writeFile, appendFile } = await import("fs/promises");
    const fn = append ? appendFile : writeFile;
    await fn(path, content, "utf-8");
    return { success: true, path, bytesWritten: content.length };
  })
  .build();
```

## Restricting Available Tools

Give the agent a focused set of tools for a specific task — prevents distraction and reduces token usage:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    allowedTools: ["web-search", "read-file"],  // LLM only sees these
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
      maxChars: 2_000,          // truncate results longer than this
      strategy: "preview",      // "preview" | "truncate" | "summarize"
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
