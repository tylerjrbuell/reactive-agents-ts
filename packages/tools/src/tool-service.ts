import { Effect, Context, Layer } from "effect";

import type {
  ToolInput,
  ToolOutput,
  ToolDefinition,
  MCPServer,
  FunctionCallingTool,
} from "./types.js";
import {
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
  ToolAuthorizationError,
  MCPConnectionError,
} from "./errors.js";
import { makeToolRegistry } from "./registry/tool-registry.js";
import { makeMCPClient } from "./mcp/mcp-client.js";
import { makeSandbox } from "./execution/sandbox.js";
import { validateToolInput } from "./validation/input-validator.js";
import { EventBus } from "@reactive-agents/core";
import { builtinTools } from "./skills/builtin.js";

// ─── Service Tag ───

/**
 * Tool service for managing and executing tools, MCP servers, and tool discovery.
 *
 * Provides a unified interface for:
 * - Registering and executing tools (built-in, custom, MCP)
 * - MCP server lifecycle (connect, disconnect, list)
 * - Tool discovery and filtering (by category, source, risk level)
 * - Format conversion for function calling (Anthropic/OpenAI format)
 * - Input validation and execution with timeout/sandbox protection
 *
 * @remarks
 * Built-in tools (file-write, file-read, web-search, http-get, code-execute, scratchpad-write, scratchpad-read)
 * are automatically registered on service startup. MCP tools are dynamically registered
 * when an MCP server connects. All tool executions are wrapped in sandboxes with timeout protection.
 *
 * @see {@link ToolDefinition} for tool metadata
 * @see {@link ToolInput} for execution parameters
 * @see {@link ToolOutput} for execution results
 */
export class ToolService extends Context.Tag("ToolService")<
  ToolService,
  {
    /**
     * Execute a tool with input validation, sandbox protection, and timeout.
     *
     * Steps:
     * 1. Look up tool in registry by name
     * 2. Validate input arguments against tool's parameter schema
     * 3. Execute handler in sandbox with configured timeout
     * 4. Publish `ToolCallCompleted` event to EventBus with timing
     * 5. Return success with result or error details
     *
     * @param input - Tool execution request (toolName, arguments, agentId, sessionId)
     * @returns ToolOutput with result, success flag, and executionTimeMs
     *
     * @throws {@link ToolNotFoundError} if tool name not registered
     * @throws {@link ToolValidationError} if arguments don't match schema
     * @throws {@link ToolExecutionError} if handler throws or sandbox detects security violation
     * @throws {@link ToolTimeoutError} if execution exceeds tool's `timeoutMs`
     * @throws {@link ToolAuthorizationError} if execution not approved (requiresApproval: true)
     *
     * @example
     * ```typescript
     * const result = yield* toolService.execute({
     *   toolName: "file-write",
     *   arguments: { path: "./output.txt", content: "Hello" },
     *   agentId: "my-agent",
     *   sessionId: "session-123",
     * });
     * console.log(result.result); // { written: true, path: "./output.txt" }
     * ```
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
     * Register a custom tool in the registry.
     *
     * @param definition - Tool metadata (name, description, parameters, riskLevel, timeout, etc.)
     * @param handler - Effect-returning async function that receives validated arguments and returns the tool result.
     *   The arguments object is keyed by parameter name, matching the `parameters` array in `definition`.
     *   Return any serializable value; it becomes `ToolOutput.result`. Throw or return `ToolExecutionError` on failure.
     * @returns Effect that completes when registration is successful
     *
     * @remarks
     * Registration is idempotent — registering a tool with the same name overwrites the previous one.
     * Built-in tools are auto-registered; use this to add custom tools or override existing ones.
     *
     * @example
     * ```typescript
     * yield* toolService.register(
     *   {
     *     name: "my-db-query",
     *     description: "Execute a database query",
     *     parameters: [
     *       { name: "query", type: "string", description: "SQL query", required: true },
     *     ],
     *     riskLevel: "high",
     *     timeoutMs: 10_000,
     *     requiresApproval: true,
     *     source: "custom",
     *   },
     *   (args) => Effect.promise(async () => {
     *     // Execute database query
     *     return await db.query(args.query);
     *   }),
     * );
     * ```
     */
    readonly register: (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ) => Effect.Effect<void, never>;

    /**
     * Connect to an MCP (Model Context Protocol) server.
     *
     * Establishes connection, discovers tools from the server, and automatically
     * registers them in the tool registry with MCP metadata. Publishes
     * `ToolMCPConnected` event to EventBus.
     *
     * @param config - MCP server configuration (name, transport, endpoint, command, args)
     * @returns MCPServer object with connection status and available tools
     *
     * @throws {@link MCPConnectionError} if connection fails, server unreachable, or discovery fails
     *
     * @remarks
     * Tool names are prefixed with `{serverName}/` to avoid conflicts.
     * MCP tools inherit risk level "medium" and timeout 30s unless overridden in server config.
     *
     * @example
     * ```typescript
     * const server = yield* toolService.connectMCPServer({
     *   name: "filesystem",
     *   transport: "stdio",
     *   command: "node",
     *   args: ["./mcp-filesystem-server.js"],
     * });
     * // Tools now available: "filesystem/read-file", "filesystem/write-file", etc.
     * ```
     */
    readonly connectMCPServer: (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args" | "cwd" | "env" | "headers"
      >,
    ) => Effect.Effect<MCPServer, MCPConnectionError>;

    /**
     * Disconnect from an MCP server.
     *
     * Closes the connection and unregisters all tools from that server.
     * Publishes `ToolMCPDisconnected` event to EventBus.
     *
     * @param serverName - Name of the MCP server to disconnect
     * @returns Effect that completes when disconnection is successful
     *
     * @throws {@link MCPConnectionError} if disconnection fails
     *
     * @example
     * ```typescript
     * yield* toolService.disconnectMCPServer("filesystem");
     * ```
     */
    readonly disconnectMCPServer: (
      serverName: string,
    ) => Effect.Effect<void, MCPConnectionError>;

    /**
     * List all available tools, optionally filtered by category, source, or risk level.
     *
     * @param filter - Optional filter object. All fields are optional; omit to return all tools.
     * @param filter.category - Filter by functional category: `"search"` | `"file"` | `"code"` | `"http"` | `"data"` | `"custom"`. @default undefined (no filter)
     * @param filter.source - Filter by tool origin: `"builtin"` | `"mcp"` | `"function"` | `"plugin"`. @default undefined (no filter)
     * @param filter.riskLevel - Filter by risk: `"low"` | `"medium"` | `"high"` | `"critical"`. @default undefined (no filter)
     * @returns Array of ToolDefinition objects matching the filter
     *
     * @remarks
     * - `category`: "search" | "file" | "code" | "http" | "data" | "custom"
     * - `source`: "builtin" | "mcp" | "function" | "plugin"
     * - `riskLevel`: "low" | "medium" | "high" | "critical"
     *
     * @example
     * ```typescript
     * const searchTools = yield* toolService.listTools({ category: "search" });
     * const mcpTools = yield* toolService.listTools({ source: "mcp" });
     * const highRiskTools = yield* toolService.listTools({ riskLevel: "high" });
     * ```
     */
    readonly listTools: (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }) => Effect.Effect<readonly ToolDefinition[], never>;

    /**
     * Get a specific tool definition by name.
     *
     * @param name - Exact tool name (including MCP prefix if applicable)
     * @returns ToolDefinition with full metadata
     *
     * @throws {@link ToolNotFoundError} if tool name is not registered
     *
     * @example
     * ```typescript
     * const fileTool = yield* toolService.getTool("file-write");
     * console.log(fileTool.parameters);
     * ```
     */
    readonly getTool: (
      name: string,
    ) => Effect.Effect<ToolDefinition, ToolNotFoundError>;

    /**
     * Convert all tools to function calling format (Anthropic/OpenAI compatible).
     *
     * Returns tool definitions in the standardized format used by Claude and ChatGPT.
     * This is used internally by reasoning strategies to inject tool schemas
     * into LLM prompts.
     *
     * @returns Array of FunctionCallingTool objects with name, description, input_schema
     *
     * @remarks
     * Each tool's `parameters` array is converted to a JSON Schema `input_schema` object.
     * Parameter `type` fields map to JSON Schema types; `required` array includes all required params.
     *
     * @example
     * ```typescript
     * const functions = yield* toolService.toFunctionCallingFormat();
     * // Each element: { name, description, input_schema: { type, properties, required } }
     * ```
     */
    readonly toFunctionCallingFormat: () => Effect.Effect<
      readonly FunctionCallingTool[],
      never
    >;

    /**
     * List all connected MCP servers.
     *
     * @returns Array of MCPServer objects with connection status and tool lists
     *
     * @example
     * ```typescript
     * const servers = yield* toolService.listMCPServers();
     * servers.forEach(s => console.log(`${s.name}: ${s.status}`));
     * ```
     */
    readonly listMCPServers: () => Effect.Effect<readonly MCPServer[], never>;
  }
>() {}

// ─── Live Implementation ───

/**
 * Live Effect-TS Layer providing the full ToolService implementation.
 *
 * On startup this layer:
 * 1. Constructs the tool registry, MCP client, and sandbox
 * 2. Subscribes to the EventBus for tool lifecycle events
 * 3. Auto-registers all 7 built-in tools:
 *    `file-write`, `file-read`, `web-search`, `http-get`,
 *    `code-execute`, `scratchpad-write`, `scratchpad-read`
 *
 * All `execute()` calls flow through input validation, sandbox execution,
 * and EventBus event publishing. MCP tool names are prefixed with `"{serverName}/"`.
 *
 * @example
 * ```typescript
 * const runtime = createRuntime({
 *   agentId: "my-agent",
 *   enableTools: true, // wires ToolServiceLive automatically
 * });
 * ```
 *
 * @see {@link ToolService} for the service interface
 */
export const ToolServiceLive = Layer.effect(
  ToolService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const registry = yield* makeToolRegistry;
    const mcpClient = yield* makeMCPClient;
    const sandbox = makeSandbox();

    const execute = (
      input: ToolInput,
    ): Effect.Effect<
      ToolOutput,
      | ToolNotFoundError
      | ToolExecutionError
      | ToolTimeoutError
      | ToolValidationError
      | ToolAuthorizationError
    > =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Step 1: Look up tool
        const tool = yield* registry.get(input.toolName);

        // Step 2: Validate input
        const validatedArgs = yield* validateToolInput(
          tool.definition,
          input.arguments,
        );

        // Step 3: Execute in sandbox with timeout
        const result = yield* sandbox.execute(
          () => tool.handler(validatedArgs),
          {
            timeoutMs: tool.definition.timeoutMs,
            toolName: input.toolName,
          },
        );

        const executionTimeMs = Date.now() - startTime;

        // Step 4: Emit event
        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.executed",
          payload: {
            toolName: input.toolName,
            success: true,
            executionTimeMs,
          },
        });

        return {
          toolName: input.toolName,
          success: true as const,
          result,
          executionTimeMs,
        } satisfies ToolOutput;
      });

    const register = (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ): Effect.Effect<void, never> => registry.register(definition, handler);

    const connectMCPServer = (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args" | "cwd" | "env" | "headers"
      >,
    ): Effect.Effect<MCPServer, MCPConnectionError> =>
      Effect.gen(function* () {
        const server = yield* mcpClient.connect(config);

        // Register each MCP tool in the registry with full schema info
        const schemas = server.toolSchemas ?? [];
        for (let i = 0; i < server.tools.length; i++) {
          const toolName = server.tools[i];
          const schema = schemas[i];

          // Convert inputSchema.properties to parameters array
          const parameters: import("./types.js").ToolParameter[] = [];
          if (schema?.inputSchema) {
            const props = schema.inputSchema.properties as
              | Record<string, { type?: string; description?: string }>
              | undefined;
            const required = (schema.inputSchema.required as string[]) ?? [];
            if (props) {
              for (const [name, prop] of Object.entries(props)) {
                parameters.push({
                  name,
                  type: (prop.type as "string" | "number" | "boolean" | "object" | "array") ?? "string",
                  description: prop.description ?? "",
                  required: required.includes(name),
                });
              }
            }
          }

          yield* registry.register(
            {
              name: `${server.name}/${toolName}`,
              description: schema?.description ?? `MCP tool from ${server.name}`,
              parameters,
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
                      message: `MCP tool ${toolName} failed: ${e instanceof Error ? e.message : String(e)}`,
                      toolName,
                      cause: e,
                    }),
                ),
              ),
          );
        }

        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.mcp-connected",
          payload: { serverName: server.name, tools: server.tools },
        });

        // Register notification listener to forward MCP server notifications to EventBus
        mcpClient.onNotification(config.name, (method, params) => {
          if (method === "notifications/message") {
            Effect.runPromise(
              eventBus.publish({
                _tag: "ChannelMessageReceived",
                sender: String(params.sender ?? "unknown"),
                platform: String(params.platform ?? "unknown"),
                message: String(params.message ?? ""),
                timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
                mcpServer: config.name,
                groupId: params.groupId != null ? String(params.groupId) : undefined,
              }),
            ).catch(() => { /* don't let EventBus errors break MCP */ });
          }
        });

        return server;
      });

    const disconnectMCPServer = (
      serverName: string,
    ): Effect.Effect<void, MCPConnectionError> =>
      Effect.gen(function* () {
        yield* mcpClient.disconnect(serverName);
        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.mcp-disconnected",
          payload: { serverName },
        });
      });

    const listTools = (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }): Effect.Effect<readonly ToolDefinition[], never> =>
      registry.list(filter);

    const getTool = (
      name: string,
    ): Effect.Effect<ToolDefinition, ToolNotFoundError> =>
      registry.get(name).pipe(Effect.map((t) => t.definition));

    const toFunctionCallingFormat = (): Effect.Effect<
      readonly FunctionCallingTool[],
      never
    > => registry.toFunctionCallingFormat();

    const listMCPServers = (): Effect.Effect<readonly MCPServer[], never> =>
      mcpClient.listServers();

    // Register built-in tools automatically
    for (const tool of builtinTools) {
      yield* registry.register(tool.definition, tool.handler);
    }

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
