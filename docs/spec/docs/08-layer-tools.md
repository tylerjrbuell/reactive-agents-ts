# Layer 8: Tools & Integration - AI Agent Implementation Spec

## Overview

MCP (Model Context Protocol) client, function calling adapter, dynamic tool registry, sandboxed execution, and pre-built skill bundles. This layer gives agents the ability to interact with the external world — executing code, searching the web, reading files, calling APIs — all through a standardized, secure interface.

**Package:** `@reactive-agents/tools`
**Dependencies:** `@reactive-agents/core` (EventBus, types)
**Optional (Phase 3):** `@reactive-agents/identity` (authorization for tool execution — enabled after Phase 3 via `Effect.serviceOption`)

---

## Package Structure

```
@reactive-agents/tools/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── tool-service.ts                   # Main ToolService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── mcp/
│   │   ├── mcp-client.ts                # MCP protocol client (JSON-RPC 2.0)
│   │   ├── mcp-discovery.ts             # Auto-discover available MCP servers
│   │   └── mcp-transport.ts             # Transport abstraction (stdio, SSE, WebSocket)
│   ├── function-calling/
│   │   └── function-adapter.ts          # Adapt native functions to tool interface
│   ├── registry/
│   │   └── tool-registry.ts             # Central tool registration & lookup
│   ├── execution/
│   │   ├── sandbox.ts                   # Sandboxed tool execution
│   │   └── timeout-guard.ts             # Execution timeout enforcement
│   ├── skills/
│   │   ├── web-search.ts                # Built-in web search skill
│   │   ├── file-operations.ts           # Built-in file read/write skill
│   │   ├── code-execution.ts            # Built-in code execution skill
│   │   └── http-client.ts               # Built-in HTTP client skill
│   └── validation/
│       └── input-validator.ts           # Tool input validation
├── tests/
│   ├── tool-service.test.ts
│   ├── mcp/
│   │   └── mcp-client.test.ts
│   ├── registry/
│   │   └── tool-registry.test.ts
│   ├── execution/
│   │   └── sandbox.test.ts
│   └── skills/
│       └── web-search.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — ToolDefinition, ToolInput, ToolOutput, MCPServerConfig schemas
2. `src/errors.ts` — All error types (ToolError, ToolNotFoundError, ToolValidationError, ToolExecutionError, MCPError, SandboxError)
3. `src/validation/input-validator.ts` — Tool input validation against schemas
4. `src/execution/timeout-guard.ts` — Execution timeout enforcement
5. `src/execution/sandbox.ts` — Sandboxed tool execution
6. `src/registry/tool-registry.ts` — Central tool registration and lookup
7. `src/function-calling/function-adapter.ts` — Adapt native functions to tool interface
8. `src/mcp/mcp-transport.ts` — Transport abstraction (stdio, SSE, WebSocket)
9. `src/mcp/mcp-discovery.ts` — Auto-discover available MCP servers
10. `src/mcp/mcp-client.ts` — MCP protocol client (JSON-RPC 2.0)
11. `src/skills/web-search.ts` — Built-in web search skill
12. `src/skills/file-operations.ts` — Built-in file read/write skill
13. `src/skills/http-client.ts` — Built-in HTTP client skill
14. `src/skills/code-execution.ts` — Built-in code execution skill
15. `src/tool-service.ts` — Main ToolService Context.Tag + ToolServiceLive
16. `src/index.ts` — Public re-exports
17. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer } from "effect";

// ─── Tool Definition ───

export const ToolParameterSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("string", "number", "boolean", "object", "array"),
  description: Schema.String,
  required: Schema.Boolean,
  default: Schema.optional(Schema.Unknown),
  enum: Schema.optional(Schema.Array(Schema.String)),
});
export type ToolParameter = typeof ToolParameterSchema.Type;

export const ToolDefinitionSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.Array(ToolParameterSchema),
  returnType: Schema.optional(Schema.String),
  category: Schema.optional(
    Schema.Literal("search", "file", "code", "http", "data", "custom"),
  ),
  riskLevel: Schema.Literal("low", "medium", "high", "critical"),
  timeoutMs: Schema.Number,
  requiresApproval: Schema.Boolean,
  source: Schema.Literal("builtin", "mcp", "function", "plugin"),
});
export type ToolDefinition = typeof ToolDefinitionSchema.Type;

// ─── Tool Execution ───

export const ToolInputSchema = Schema.Struct({
  toolName: Schema.String,
  arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  agentId: Schema.String,
  sessionId: Schema.String,
  correlationId: Schema.optional(Schema.String),
});
export type ToolInput = typeof ToolInputSchema.Type;

export const ToolOutputSchema = Schema.Struct({
  toolName: Schema.String,
  success: Schema.Boolean,
  result: Schema.Unknown,
  error: Schema.optional(Schema.String),
  executionTimeMs: Schema.Number,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type ToolOutput = typeof ToolOutputSchema.Type;

// ─── MCP Types ───

export const MCPServerSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  transport: Schema.Literal("stdio", "sse", "websocket"),
  endpoint: Schema.optional(Schema.String), // For sse/websocket
  command: Schema.optional(Schema.String), // For stdio
  args: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.Array(Schema.String),
  status: Schema.Literal("connected", "disconnected", "error"),
});
export type MCPServer = typeof MCPServerSchema.Type;

export const MCPRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union(Schema.String, Schema.Number),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});
export type MCPRequest = typeof MCPRequestSchema.Type;

export const MCPResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union(Schema.String, Schema.Number),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optional(Schema.Unknown),
    }),
  ),
});
export type MCPResponse = typeof MCPResponseSchema.Type;

// ─── Function Calling (Anthropic/OpenAI format) ───

export const FunctionCallingToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: Schema.Record({ key: Schema.String, value: Schema.Unknown }), // JSON Schema
});
export type FunctionCallingTool = typeof FunctionCallingToolSchema.Type;
```

---

## Error Types

```typescript
import { Data } from "effect";

export class ToolNotFoundError extends Data.TaggedError("ToolNotFoundError")<{
  readonly message: string;
  readonly toolName: string;
  readonly availableTools?: readonly string[];
}> {}

export class ToolExecutionError extends Data.TaggedError("ToolExecutionError")<{
  readonly message: string;
  readonly toolName: string;
  readonly input?: unknown;
  readonly cause?: unknown;
}> {}

export class ToolTimeoutError extends Data.TaggedError("ToolTimeoutError")<{
  readonly message: string;
  readonly toolName: string;
  readonly timeoutMs: number;
}> {}

export class ToolValidationError extends Data.TaggedError(
  "ToolValidationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly parameter: string;
  readonly expected: string;
  readonly received: string;
}> {}

export class MCPConnectionError extends Data.TaggedError("MCPConnectionError")<{
  readonly message: string;
  readonly serverName: string;
  readonly transport: string;
  readonly cause?: unknown;
}> {}

export class ToolAuthorizationError extends Data.TaggedError(
  "ToolAuthorizationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly agentId: string;
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context } from "effect";

export class ToolService extends Context.Tag("ToolService")<
  ToolService,
  {
    /**
     * Execute a tool by name with validated input.
     * Handles authorization, validation, sandboxing, timeout, and audit logging.
     */
    readonly execute: (
      input: ToolInput,
    ) => Effect.Effect<
      ToolOutput,
      | ToolNotFoundError
      | ToolExecutionError
      | ToolTimeoutError
      | ToolValidationError
      | ToolAuthorizationError
    >;

    /**
     * Register a new tool in the registry.
     */
    readonly register: (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ) => Effect.Effect<void, never>;

    /**
     * Discover and register tools from an MCP server.
     */
    readonly connectMCPServer: (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args"
      >,
    ) => Effect.Effect<MCPServer, MCPConnectionError>;

    /**
     * Disconnect from an MCP server.
     */
    readonly disconnectMCPServer: (
      serverName: string,
    ) => Effect.Effect<void, MCPConnectionError>;

    /**
     * List all available tools with their definitions.
     */
    readonly listTools: (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }) => Effect.Effect<readonly ToolDefinition[], never>;

    /**
     * Get a specific tool definition.
     */
    readonly getTool: (
      name: string,
    ) => Effect.Effect<ToolDefinition, ToolNotFoundError>;

    /**
     * Convert all registered tools to Anthropic/OpenAI function calling format.
     * Used when sending tool definitions to LLMs.
     */
    readonly toFunctionCallingFormat: () => Effect.Effect<
      readonly FunctionCallingTool[],
      never
    >;

    /**
     * List connected MCP servers and their status.
     */
    readonly listMCPServers: () => Effect.Effect<readonly MCPServer[], never>;
  }
>() {}
```

---

## Tool Registry Implementation

```typescript
import { Effect, Ref } from "effect";

interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError>;
}

export const makeToolRegistry = Effect.gen(function* () {
  const toolsRef = yield* Ref.make<Map<string, RegisteredTool>>(new Map());

  const register = (
    definition: ToolDefinition,
    handler: (
      args: Record<string, unknown>,
    ) => Effect.Effect<unknown, ToolExecutionError>,
  ): Effect.Effect<void, never> =>
    Ref.update(toolsRef, (tools) => {
      const newTools = new Map(tools);
      newTools.set(definition.name, { definition, handler });
      return newTools;
    });

  const get = (
    name: string,
  ): Effect.Effect<RegisteredTool, ToolNotFoundError> =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      const tool = tools.get(name);
      if (!tool) {
        const available = [...tools.keys()];
        return yield* Effect.fail(
          new ToolNotFoundError({
            message: `Tool "${name}" not found`,
            toolName: name,
            availableTools: available,
          }),
        );
      }
      return tool;
    });

  const list = (filter?: {
    category?: string;
    source?: string;
    riskLevel?: string;
  }): Effect.Effect<readonly ToolDefinition[], never> =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      let definitions = [...tools.values()].map((t) => t.definition);

      if (filter?.category)
        definitions = definitions.filter((d) => d.category === filter.category);
      if (filter?.source)
        definitions = definitions.filter((d) => d.source === filter.source);
      if (filter?.riskLevel)
        definitions = definitions.filter(
          (d) => d.riskLevel === filter.riskLevel,
        );

      return definitions;
    });

  const toFunctionCallingFormat = (): Effect.Effect<
    readonly FunctionCallingTool[],
    never
  > =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      return [...tools.values()].map((t) => ({
        name: t.definition.name,
        description: t.definition.description,
        input_schema: {
          type: "object",
          properties: Object.fromEntries(
            t.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                ...(p.enum ? { enum: p.enum } : {}),
              },
            ]),
          ),
          required: t.definition.parameters
            .filter((p) => p.required)
            .map((p) => p.name),
        },
      }));
    });

  return { register, get, list, toFunctionCallingFormat };
});
```

---

## MCP Client Implementation

```typescript
import { Effect, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";

export const makeMCPClient = Effect.gen(function* () {
  const eventBus = yield* EventBus;
  const serversRef = yield* Ref.make<Map<string, MCPServer>>(new Map());
  let requestId = 0;

  const connect = (
    config: Pick<
      MCPServer,
      "name" | "transport" | "endpoint" | "command" | "args"
    >,
  ): Effect.Effect<MCPServer, MCPConnectionError> =>
    Effect.gen(function* () {
      // Step 1: Establish connection based on transport
      const transport = yield* createTransport(config).pipe(
        Effect.mapError(
          (e) =>
            new MCPConnectionError({
              message: `Failed to connect to MCP server "${config.name}"`,
              serverName: config.name,
              transport: config.transport,
              cause: e,
            }),
        ),
      );

      // Step 2: Initialize protocol (send initialize request)
      const initResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: ++requestId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "reactive-agents", version: "1.0.0" },
        },
      });

      // Step 3: Discover available tools
      const toolsResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/list",
      });

      const toolNames = Array.isArray(toolsResponse.result)
        ? toolsResponse.result.map((t: any) => t.name as string)
        : [];

      const server: MCPServer = {
        name: config.name,
        version: (initResponse.result as any)?.serverInfo?.version ?? "unknown",
        transport: config.transport,
        endpoint: config.endpoint,
        command: config.command,
        args: config.args,
        tools: toolNames,
        status: "connected",
      };

      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        newServers.set(server.name, server);
        return newServers;
      });

      yield* eventBus.publish({
        type: "tools.mcp-connected",
        payload: { serverName: server.name, tools: toolNames },
      });

      return server;
    });

  const callTool = (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, MCPConnectionError | ToolExecutionError> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      const server = servers.get(serverName);

      if (!server || server.status !== "connected") {
        return yield* Effect.fail(
          new MCPConnectionError({
            message: `MCP server "${serverName}" not connected`,
            serverName,
            transport: server?.transport ?? "unknown",
          }),
        );
      }

      const response = yield* sendRequest(
        {
          name: serverName,
          transport: server.transport,
          endpoint: server.endpoint,
          command: server.command,
        },
        {
          jsonrpc: "2.0",
          id: ++requestId,
          method: "tools/call",
          params: { name: toolName, arguments: args },
        },
      );

      if (response.error) {
        return yield* Effect.fail(
          new ToolExecutionError({
            message: `MCP tool "${toolName}" failed: ${response.error.message}`,
            toolName,
            input: args,
          }),
        );
      }

      return response.result;
    });

  const disconnect = (
    serverName: string,
  ): Effect.Effect<void, MCPConnectionError> =>
    Effect.gen(function* () {
      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        const server = newServers.get(serverName);
        if (server) {
          newServers.set(serverName, { ...server, status: "disconnected" });
        }
        return newServers;
      });

      yield* eventBus.publish({
        type: "tools.mcp-disconnected",
        payload: { serverName },
      });
    });

  const listServers = (): Effect.Effect<readonly MCPServer[], never> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      return [...servers.values()];
    });

  return { connect, callTool, disconnect, listServers };
});

// ─── Transport Creation (stub - real implementation varies by transport) ───

const createTransport = (
  config: Pick<
    MCPServer,
    "name" | "transport" | "endpoint" | "command" | "args"
  >,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    switch (config.transport) {
      case "stdio":
        // Spawn child process with config.command + config.args
        // Communicate via stdin/stdout
        break;
      case "sse":
        // Connect to config.endpoint via Server-Sent Events
        break;
      case "websocket":
        // Connect to config.endpoint via WebSocket
        break;
    }
  });

// ─── JSON-RPC request sender (stub) ───

const sendRequest = (
  config: Pick<MCPServer, "name" | "transport" | "endpoint" | "command">,
  request: MCPRequest,
): Effect.Effect<MCPResponse, MCPConnectionError> =>
  Effect.gen(function* () {
    // Real implementation sends via the established transport
    // and waits for response matching request.id
    return {
      jsonrpc: "2.0" as const,
      id: request.id,
      result: {},
    };
  });
```

---

## Sandboxed Execution

```typescript
import { Effect } from "effect";

export const makeSandbox = () => {
  const execute = <A>(
    fn: () => Effect.Effect<A, ToolExecutionError>,
    options: { timeoutMs: number; maxMemoryMB?: number },
  ): Effect.Effect<A, ToolExecutionError | ToolTimeoutError> =>
    fn().pipe(
      // Enforce timeout
      Effect.timeout(`${options.timeoutMs} millis`),
      Effect.mapError((e) => {
        if (
          e &&
          typeof e === "object" &&
          "_tag" in e &&
          e._tag === "TimeoutException"
        ) {
          return new ToolTimeoutError({
            message: `Tool execution timed out after ${options.timeoutMs}ms`,
            toolName: "unknown",
            timeoutMs: options.timeoutMs,
          });
        }
        return e as ToolExecutionError;
      }),
      // Catch unexpected errors
      Effect.catchAllDefect((defect) =>
        Effect.fail(
          new ToolExecutionError({
            message: `Tool crashed: ${String(defect)}`,
            toolName: "unknown",
            cause: defect,
          }),
        ),
      ),
    );

  return { execute };
};
```

---

## Input Validator

```typescript
import { Effect } from "effect";

export const validateToolInput = (
  definition: ToolDefinition,
  args: Record<string, unknown>,
): Effect.Effect<Record<string, unknown>, ToolValidationError> =>
  Effect.gen(function* () {
    const validated: Record<string, unknown> = {};

    for (const param of definition.parameters) {
      const value = args[param.name];

      // Check required
      if (param.required && (value === undefined || value === null)) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Missing required parameter "${param.name}"`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.type,
            received: "undefined",
          }),
        );
      }

      if (value === undefined) {
        if (param.default !== undefined) {
          validated[param.name] = param.default;
        }
        continue;
      }

      // Type check
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (
        actualType !== param.type &&
        !(param.type === "object" && actualType === "object")
      ) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Parameter "${param.name}" expected ${param.type}, got ${actualType}`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.type,
            received: actualType,
          }),
        );
      }

      // Enum check
      if (
        param.enum &&
        typeof value === "string" &&
        !param.enum.includes(value)
      ) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Parameter "${param.name}" must be one of: ${param.enum.join(", ")}`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.enum.join(" | "),
            received: String(value),
          }),
        );
      }

      validated[param.name] = value;
    }

    return validated;
  });
```

---

## Main ToolService Implementation

```typescript
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import { IdentityService } from "@reactive-agents/identity";

export const ToolServiceLive = Layer.effect(
  ToolService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const identity = yield* IdentityService;
    const registry = yield* makeToolRegistry;
    const mcpClient = yield* makeMCPClient;
    const sandbox = makeSandbox();

    const execute = (input: ToolInput) =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Step 1: Look up tool
        const tool = yield* registry.get(input.toolName);

        // Step 2: Authorize agent for this tool
        yield* identity
          .authorize(input.agentId, `tools/${input.toolName}`, "execute")
          .pipe(
            Effect.mapError(
              (e) =>
                new ToolAuthorizationError({
                  message: `Agent ${input.agentId} not authorized to execute tool "${input.toolName}"`,
                  toolName: input.toolName,
                  agentId: input.agentId,
                }),
            ),
          );

        // Step 3: Validate input
        const validatedArgs = yield* validateToolInput(
          tool.definition,
          input.arguments,
        );

        // Step 4: Execute in sandbox with timeout
        const result = yield* sandbox.execute(
          () => tool.handler(validatedArgs),
          { timeoutMs: tool.definition.timeoutMs },
        );

        const executionTimeMs = Date.now() - startTime;

        // Step 5: Audit log
        yield* identity
          .audit({
            agentId: input.agentId,
            sessionId: input.sessionId,
            action: "tool.execute",
            resource: `tools/${input.toolName}`,
            result: "success",
            durationMs: executionTimeMs,
            metadata: { correlationId: input.correlationId },
          })
          .pipe(Effect.catchAll(() => Effect.void)); // Don't fail on audit errors

        // Step 6: Emit event
        yield* eventBus.publish({
          type: "tools.executed",
          payload: { toolName: input.toolName, success: true, executionTimeMs },
        });

        return {
          toolName: input.toolName,
          success: true,
          result,
          executionTimeMs,
        } satisfies ToolOutput;
      });

    const register = (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ) => registry.register(definition, handler);

    const connectMCPServer = (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args"
      >,
    ) =>
      Effect.gen(function* () {
        const server = yield* mcpClient.connect(config);

        // Register each MCP tool in the registry
        for (const toolName of server.tools) {
          yield* registry.register(
            {
              name: `${server.name}/${toolName}`,
              description: `MCP tool from ${server.name}`,
              parameters: [], // Would be populated from MCP tools/list response
              riskLevel: "medium",
              timeoutMs: 30_000,
              requiresApproval: false,
              source: "mcp",
            },
            (args) =>
              mcpClient.callTool(server.name, toolName, args).pipe(
                Effect.mapError(
                  (e) =>
                    new ToolExecutionError({
                      message: `MCP tool ${toolName} failed`,
                      toolName,
                      cause: e,
                    }),
                ),
              ),
          );
        }

        return server;
      });

    const disconnectMCPServer = (serverName: string) =>
      mcpClient.disconnect(serverName);

    const listTools = (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }) => registry.list(filter);

    const getTool = (name: string) =>
      registry.get(name).pipe(Effect.map((t) => t.definition));

    const toFunctionCallingFormat = () => registry.toFunctionCallingFormat();

    const listMCPServers = () => mcpClient.listServers();

    return {
      execute,
      register,
      connectMCPServer,
      disconnectMCPServer,
      listTools,
      getTool,
      toFunctionCallingFormat,
      listMCPServers,
    };
  }),
);
```

---

## Built-in Skills

### Web Search Skill

```typescript
import { Effect } from "effect";

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description: "Search the web for information using a query string",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query",
      required: true,
    },
    {
      name: "maxResults",
      type: "number",
      description: "Max results to return",
      required: false,
      default: 5,
    },
  ],
  category: "search",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
};

export const webSearchHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      // In production: call search API (Tavily, SerpAPI, etc.)
      const query = args.query as string;
      const maxResults = (args.maxResults as number) ?? 5;

      const response = await fetch(
        `https://api.tavily.com/search?query=${encodeURIComponent(query)}&max_results=${maxResults}`,
        { headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` } },
      );

      return response.json();
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Web search failed: ${e}`,
        toolName: "web-search",
        cause: e,
      }),
  });
```

### File Operations Skill

```typescript
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const fileReadTool: ToolDefinition = {
  name: "file-read",
  description: "Read the contents of a file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "File path to read",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description: "File encoding",
      required: false,
      default: "utf-8",
    },
  ],
  category: "file",
  riskLevel: "medium",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
};

export const fileReadHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const filePath = args.path as string;
      const encoding = (args.encoding as BufferEncoding) ?? "utf-8";

      // Security: resolve path and check it's within allowed directory
      const resolved = path.resolve(filePath);
      const allowedBase = process.cwd();
      if (!resolved.startsWith(allowedBase)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      return await fs.readFile(resolved, { encoding });
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `File read failed: ${e}`,
        toolName: "file-read",
        cause: e,
      }),
  });
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import {
  ToolService,
  ToolServiceLive,
  ToolNotFoundError,
  ToolValidationError,
} from "../src";

const TestToolLayer = ToolServiceLive.pipe(
  Layer.provide(TestEventBusLayer),
  Layer.provide(TestIdentityLayer),
);

describe("ToolService", () => {
  it("should register and execute a tool", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register a simple tool
      yield* tools.register(
        {
          name: "add",
          description: "Add two numbers",
          parameters: [
            {
              name: "a",
              type: "number",
              description: "First number",
              required: true,
            },
            {
              name: "b",
              type: "number",
              description: "Second number",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed((args.a as number) + (args.b as number)),
      );

      const result = yield* tools.execute({
        toolName: "add",
        arguments: { a: 2, b: 3 },
        agentId: "agent-1",
        sessionId: "session-1",
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should fail for unknown tools", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const result = yield* tools
        .execute({
          toolName: "nonexistent",
          arguments: {},
          agentId: "agent-1",
          sessionId: "session-1",
        })
        .pipe(Effect.flip);

      expect(result._tag).toBe("ToolNotFoundError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should validate tool input parameters", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "greet",
          description: "Greet a person",
          parameters: [
            {
              name: "name",
              type: "string",
              description: "Person name",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(`Hello, ${args.name}!`),
      );

      // Missing required parameter
      const result = yield* tools
        .execute({
          toolName: "greet",
          arguments: {},
          agentId: "agent-1",
          sessionId: "session-1",
        })
        .pipe(Effect.flip);

      expect(result._tag).toBe("ToolValidationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should list tools in function calling format", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "search",
          description: "Search for something",
          parameters: [
            {
              name: "query",
              type: "string",
              description: "Search query",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 10000,
          requiresApproval: false,
          source: "builtin",
        },
        (args) => Effect.succeed([]),
      );

      const fcTools = yield* tools.toFunctionCallingFormat();
      expect(fcTools).toHaveLength(1);
      expect(fcTools[0].name).toBe("search");
      expect(fcTools[0].input_schema).toHaveProperty("properties");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should connect to an MCP server", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const server = yield* tools.connectMCPServer({
        name: "test-server",
        transport: "stdio",
        command: "node",
        args: ["test-mcp-server.js"],
      });

      expect(server.status).toBe("connected");
      expect(server.name).toBe("test-server");

      const servers = yield* tools.listMCPServers();
      expect(servers).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });
});
```

---

## Configuration

```typescript
export const ToolsConfig = {
  // Execution
  execution: {
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000, // 5 minutes max
    sandboxEnabled: true,
  },

  // MCP
  mcp: {
    protocolVersion: "2024-11-05",
    connectionTimeoutMs: 10_000,
    requestTimeoutMs: 30_000,
    maxRetries: 3,
  },

  // Registry
  registry: {
    maxTools: 1000,
    allowDuplicateNames: false,
  },

  // Security
  security: {
    requireAuthorizationForAll: true,
    blockHighRiskWithoutApproval: true,
    allowedFilePathPrefix: process.cwd(),
    blockedCommands: ["rm -rf /", "sudo", ":(){:|:&};:"],
  },

  // Built-in tools to auto-register
  builtinTools: [
    "web-search",
    "file-read",
    "file-write",
    "http-get",
    "code-execute",
  ],
};
```

---

## Performance Targets

| Metric                      | Target | Notes                          |
| --------------------------- | ------ | ------------------------------ |
| Tool lookup                 | <1ms   | In-memory registry             |
| Input validation            | <2ms   | Schema-based check             |
| Authorization check         | <5ms   | Identity service call          |
| Built-in tool execution     | <100ms | Excluding external API latency |
| MCP tool execution          | <5s    | Depends on MCP server          |
| MCP server connection       | <10s   | Including tool discovery       |
| Function calling conversion | <5ms   | Format all tools for LLM       |

---

## Integration Points

- **Identity** (Layer 6): Authorization check before every tool execution, audit logging of all tool calls
- **EventBus** (Layer 1): Emits `tools.executed`, `tools.failed`, `tools.mcp-connected`, `tools.mcp-disconnected` events
- **LLMService** (Layer 1.5): `toFunctionCallingFormat()` provides tool definitions for LLM function calling
- **Reasoning** (Layer 3): Reasoning engine selects and calls tools via this service
- **Cost** (Layer 5): Tool execution costs (API calls) tracked
- **Observability** (Layer 9): Tool execution spans and metrics exported

## Success Criteria

- [ ] MCP protocol client working with stdio, SSE, and WebSocket transports
- [ ] Dynamic tool discovery from MCP servers
- [ ] Tool registry with register/lookup/list operations
- [ ] Input validation with type checking, required fields, enum constraints
- [ ] Sandboxed execution with timeout enforcement
- [ ] Authorization check before every tool execution
- [ ] Function calling format export for Anthropic/OpenAI APIs
- [ ] Built-in skill bundles (web search, file ops, HTTP, code execution)
- [ ] All operations use Effect-TS patterns (no raw async/await)

**Status: Ready for implementation**
**Priority: Phase 1 (Week 3) - Basic registry & execution, Phase 3 - Full MCP**
