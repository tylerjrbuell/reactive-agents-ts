---
title: 'Advanced Custom Tools'
description: >-
  The deeper-control path for custom tools — raw ToolDefinition objects,
  side-effecting tools with Effect-native handlers, and a manual approval
  check — for when defineTool() isn't enough.
sidebar:
  order: 8
topic: tools
related:
  - guides/tools
  - cookbook/agent-tool-calling-mcp
  - guides/durable-hitl
  - cookbook/testing-agents
---

:::note[Most tools don't need this page]
Start with [`defineTool`](/guides/tools/custom-tools/#registering-custom-tools) or the
[`tool()` helper](/cookbook/agent-tool-calling-mcp/#step-1--an-agent-with-one-custom-tool) —
plain `async`/sync handlers, no Effect knowledge required. Reach for what's
below when you want a raw `ToolDefinition` for integrating with an existing
registry, or an Effect-native handler for structured error channels and
resource-safe cleanup. Effect was never excluded — it's just not the default path.
:::

The [Tools guide](/guides/tools/) is the canonical home for the tool system. This recipe covers only the lower-level pieces. Everything else that used to live here is there:

- **Fluent `ToolBuilder`, parameter types, categories and risk levels:** [ToolBuilder Fluent API](/guides/tools/custom-tools/#toolbuilder-fluent-api) and its [method table](/guides/tools/custom-tools/#toolbuilder-methods).
- **Restricting the tool set (`allowedTools`, `focusedTools`):** [Scoping the Tool Set](/guides/tools/scoping-and-policy/#scoping-the-tool-set).
- **Result compression (`resultCompression`):** [Tool Result Compression](/guides/tools/execution-and-results/#tool-result-compression).
- **MCP servers (`.withMCP()`):** [MCP Support](/guides/tools/mcp-tools/), or the [hands-on walkthrough](/cookbook/agent-tool-calling-mcp/).

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

For tools that modify state, raise the `riskLevel` and return structured results so the agent can reason about success/failure. The `ToolBuilder` builds the definition and catches misconfiguration at build time (a missing description throws). The handler is supplied at registration through `.withTools({ tools })`. It receives a single `args` record and returns an `Effect`: use `Effect.succeed(...)` for pure values, `Effect.try(...)` for synchronous code that can throw and `Effect.tryPromise(...)` for async work. Errors reach the agent as observations instead of crashing the run.

```typescript
import { ReactiveAgents } from "reactive-agents";
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

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ tools: [{ definition: writeFileDef, handler: writeFileHandler }] })
  .build();
```

For a fully *typed* handler (validated args inferred from a schema, plain `async` functions allowed), use [`defineTool`](/guides/tools/custom-tools/#registering-custom-tools) — its result is directly assignable to the `tools` array.

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

To have the **framework** hold a run on a gated call until a person decides, use [Human-in-the-Loop Approval](/guides/durable-hitl/): name the tool in `.withApprovalPolicy({ tools: ["delete-file"], mode: "detach" })` and answer with `agent.approveRun(runId)` / `denyRun(runId, reason)`. Without durable runs the run waits in process (`runStream()` emits `ApprovalRequested`); with `.withDurableRuns()` it returns `status: "awaiting-approval"` and can be answered from any process. The manual pattern below is for when you want to gate execution in your own pipeline.

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

## What's Next

- [Tools](/guides/tools/) — the built-in tool registry, sandboxing, `ToolBuilder`, MCP and reasoning integration
- [Build an Agent with Tool Calling and MCP](/cookbook/agent-tool-calling-mcp/) — a full walkthrough including MCP servers
- [Testing Agents](/cookbook/testing-agents/) — mock and test the custom tools built here
