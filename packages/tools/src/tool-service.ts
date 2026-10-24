import { Effect, Context, Layer, Option } from "effect";

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
import { ToolResultCache } from "./caching/tool-result-cache.js";
import { ToolApprovalGate, definitionRequiresApproval } from "./governance/tool-approval-gate.js";

/**
 * Maps an MCP tool's raw JSON Schema `type` string onto `ToolParameter`'s
 * narrower set. JSON Schema distinguishes `"integer"` from `"number"`;
 * `ToolParameter`'s own doc comment says `"number"` already covers "integer
 * or float" — so `"integer"` folds into it rather than failing schema
 * validation. Found live (2026-09-17) against Google Home MCP, whose real
 * tool schemas use `"integer"` for several parameters — every such tool
 * failed to register at all before this normalization existed. Anything
 * else unrecognized (e.g. a JSON Schema `type` array, or `"null"`) falls
 * back to `"string"`, the most permissive representation, rather than
 * crashing registration over a single odd parameter.
 */
function normalizeJsonSchemaType(
  type: string | undefined,
): "string" | "number" | "boolean" | "object" | "array" {
  switch (type) {
    case "integer":
      return "number";
    case "string":
    case "number":
    case "boolean":
    case "object":
    case "array":
      return type;
    default:
      return "string";
  }
}

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
     * 4. Derive `success` from the completed handler result (see failure
     *    contract below), cache it, publish `ToolCallCompleted`, return it
     *
     * Handler failure contract: a completed handler result that is a plain
     * object with `success === false` yields a FAILED ToolOutput and
     * `tools.executed` with `success: false` — a failed observation, not a
     * defect. The refusal payload still rides in `result` verbatim.
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
     * // `path` is the RESOLVED absolute path under the active file root
     * console.log(result.result); // { written: true, path: "/abs/root/output.txt" }
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
        | "name"
        | "transport"
        | "endpoint"
        | "command"
        | "args"
        | "cwd"
        | "env"
        | "headers"
        | "auth"
        | "tokenStore"
        | "defaultRiskLevel"
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

    /**
     * Remove a previously registered custom tool from the registry.
     *
     * Built-in tools (source: "builtin") are protected and cannot be removed.
     * Attempting to unregister an unknown tool name is a no-op (no error thrown).
     *
     * @param name - Exact tool name to remove
     * @returns Effect that completes when unregistration is done
     *
     * @example
     * ```typescript
     * yield* toolService.unregisterTool("my-db-query");
     * ```
     */
    readonly unregisterTool: (name: string) => Effect.Effect<void, never>;
  }
>() {}

// ─── Live Implementation ───

/**
 * Detect an IN-PAYLOAD handler failure: a COMPLETED result that is a plain
 * object with `success === false` (e.g. shell-execute's
 * `{ executed: false, success: false, error }` denial). `execute` surfaces
 * these as failed ToolOutputs — like kernel-internal tool-policy/approval-deny
 * blocks — instead of the previously hardcoded success:true; the refusal
 * payload still rides in `result` verbatim.
 */
function handlerReportsFailure(result: unknown): boolean {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return false;
  }
  return (result as Record<string, unknown>).success === false;
}

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

        // Step 2.4: Authorization gate (hotfix 0.5-3, opt-in — ToolApprovalGate
        // may not be provided). Fail closed for requiresApproval tools when a
        // gate is wired; unprovided = today's behavior (no regression). This is
        // the service-layer choke every execute path shares, closing the
        // direct-caller bypass the kernel HITL gate never covered.
        if (definitionRequiresApproval(tool.definition)) {
          const gateOpt = yield* Effect.serviceOption(ToolApprovalGate);
          if (Option.isSome(gateOpt)) {
            const decision = yield* gateOpt.value.authorize({
              toolName: input.toolName,
              riskLevel: tool.definition.riskLevel,
              requiresApproval: true,
              arguments: validatedArgs,
              agentId: input.agentId,
              sessionId: input.sessionId,
            });
            if (!decision.approved) {
              return yield* Effect.fail(
                new ToolAuthorizationError({
                  message:
                    decision.reason ??
                    `Tool "${input.toolName}" requires approval and was not authorized.`,
                  toolName: input.toolName,
                  agentId: input.agentId,
                }),
              );
            }
          }
        }

        // Step 2.5: Check cache (opt-in — ToolResultCache may not be provided)
        const cacheOpt = yield* Effect.serviceOption(ToolResultCache);
        if (Option.isSome(cacheOpt) && tool.definition.isCacheable !== false) {
          const cached = yield* cacheOpt.value.check(
            input.toolName,
            validatedArgs,
          );
          if (cached) {
            const executionTimeMs = Date.now() - startTime;
            yield* eventBus.publish({
              _tag: "Custom",
              type: "tools.executed",
              payload: {
                toolName: input.toolName,
                success: cached.success,
                executionTimeMs,
                cached: true,
              },
            });
            return {
              toolName: input.toolName,
              success: cached.success,
              result: cached.result,
              executionTimeMs,
              metadata: { cached: true },
            } satisfies ToolOutput;
          }
        }

        // Step 3: Execute in sandbox with timeout
        const result = yield* sandbox.execute(
          () => tool.handler(validatedArgs),
          {
            // Raw-object tool registrations (`.withTools({ tools: [...] })`)
            // may omit timeoutMs; default to 30 s rather than pass undefined
            // (which becomes a 1 ms NaN-coerced timeout). The sandbox guards
            // this too — belt and suspenders on the primary custom-tool path.
            timeoutMs: tool.definition.timeoutMs ?? 30_000,
            toolName: input.toolName,
          },
        );

        const executionTimeMs = Date.now() - startTime;

        // Step 3.5: Derive observation status from the handler result (in-payload
        // {success:false} = failed observation — see handlerReportsFailure).
        const success = !handlerReportsFailure(result);

        // Step 3.5: Store in cache if available
        if (Option.isSome(cacheOpt) && tool.definition.isCacheable !== false) {
          yield* cacheOpt.value.store(
            input.toolName,
            validatedArgs,
            result,
            success,
            tool.definition.cacheTtlMs,
          );
        }

        // Step 4: Emit event
        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.executed",
          payload: {
            toolName: input.toolName,
            success,
            executionTimeMs,
          },
        });

        return {
          toolName: input.toolName,
          success,
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
        | "name"
        | "transport"
        | "endpoint"
        | "command"
        | "args"
        | "cwd"
        | "env"
        | "headers"
        | "auth"
        | "tokenStore"
        | "defaultRiskLevel"
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
                  type: normalizeJsonSchemaType(prop.type),
                  description: prop.description ?? "",
                  required: required.includes(name),
                });
              }
            }
          }

          yield* registry.register(
            {
              name: `${server.name}/${toolName}`,
              description: `[${server.name}/${toolName}] ${schema?.description ?? `MCP tool from ${server.name}`}`,
              parameters,
              riskLevel: config.defaultRiskLevel ?? "medium",
              timeoutMs: 30_000,
              requiresApproval: false,
              source: "mcp",
              // MCP tools return data into the run by default (audit 01-F1 / C2);
              // a server that writes files can declare `produces: "file"`.
              produces: "data",
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

    const unregisterTool = (name: string): Effect.Effect<void, never> =>
      registry.unregister(name);

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
      unregisterTool,
    };
  }),
);
