import { Schema } from "effect";

// ─── Tool Definition ───

/**
 * Schema for a tool parameter.
 *
 * Describes a single input parameter of a tool, including its type, description,
 * requirement, and optional constraints (default value, enum choices).
 *
 * @see {@link ToolParameter} for the TypeScript type
 */
export const ToolParameterSchema = Schema.Struct({
  /** Unique parameter name — used as the key in the `arguments` object when calling the tool. */
  name: Schema.String,
  /**
   * JSON Schema type of the parameter value.
   *
   * - `"string"` — plain text value
   * - `"number"` — numeric (integer or float)
   * - `"boolean"` — true/false flag
   * - `"object"` — structured JSON object
   * - `"array"` — ordered list of values
   */
  type: Schema.Literal("string", "number", "boolean", "object", "array"),
  /**
   * Human-readable description shown to the LLM.
   *
   * Be specific — the LLM uses this to decide how to populate the parameter.
   * Include format hints (e.g. "ISO 8601 date string", "absolute file path").
   */
  description: Schema.String,
  /**
   * Whether the parameter must be supplied by the LLM.
   *
   * Required parameters must appear in the `required` array of the generated JSON Schema.
   * Optional parameters (`false`) may be omitted; use `default` to specify the fallback.
   */
  required: Schema.Boolean,
  /**
   * Default value when the parameter is omitted.
   *
   * Only meaningful when `required: false`. If not set, the tool implementation
   * must handle the missing value gracefully.
   *
   * @default undefined
   */
  default: Schema.optional(Schema.Unknown),
  /**
   * Item schema for array-type parameters.
   *
   * Required by Gemini when `type: "array"`. Describes the type of each element.
   * Use `{ type: "string" }` for string arrays, `{ type: "object" }` for object arrays.
   *
   * @example `{ type: "string" }`
   */
  items: Schema.optional(Schema.Struct({ type: Schema.String })),
  /**
   * Restricted set of allowed string values (enum constraint).
   *
   * When present, the LLM is instructed to pick one of these values.
   * Only applicable when `type: "string"`.
   *
   * @example `["web", "news", "images"]`
   */
  enum: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * A tool parameter definition.
 *
 * @remarks
 * Used in tool schemas to describe inputs. The `type` field maps to JSON Schema types.
 * For `object` or `array` types, provide a JSON Schema description in the `description` field.
 *
 * @example
 * ```typescript
 * const param: ToolParameter = {
 *   name: "query",
 *   type: "string",
 *   description: "Search query (required)",
 *   required: true,
 *   enum: ["web", "news", "images"], // Optional: restrict to choices
 * };
 * ```
 */
export type ToolParameter = typeof ToolParameterSchema.Type;

/**
 * Schema for a complete tool definition.
 *
 * Describes a tool that can be executed by an agent, including metadata
 * for discovery, risk assessment, timeouts, and approval requirements.
 *
 * @see {@link ToolDefinition} for the TypeScript type
 */
export const ToolDefinitionSchema = Schema.Struct({
  /**
   * Unique tool identifier used to invoke it.
   *
   * Must be globally unique within the registry. MCP tools use the format
   * `"{serverName}/{toolName}"` to avoid collisions with built-in tools.
   *
   * @example `"web-search"`, `"filesystem/read-file"`
   */
  name: Schema.String,
  /**
   * Human-readable description shown to the LLM to aid tool selection.
   *
   * This is the most important field for LLM usability. Be precise about:
   * - What the tool does
   * - When to use it (vs alternatives)
   * - What it returns
   * - Any parameter naming caveats (e.g. "IMPORTANT: use 'path' not 'file'")
   */
  description: Schema.String,
  /**
   * Array of input parameter definitions for the tool.
   *
   * Each parameter describes one argument the LLM must (or may) supply.
   * Used to generate JSON Schema for function calling and to validate input.
   *
   * @see {@link ToolParameter}
   */
  parameters: Schema.Array(ToolParameterSchema),
  /**
   * Human-readable description of the tool's return value shape.
   *
   * Shown to the LLM so it knows what to expect from the result.
   * Use a JSON-like notation, e.g. `"{ written: true, path: string }"`.
   *
   * @default undefined
   * @example `"{ results: [{ title: string, url: string, content: string }] }"`
   */
  returnType: Schema.optional(Schema.String),
  /**
   * Functional category for tool discovery and filtering.
   *
   * - `"search"` — Web search, document retrieval
   * - `"file"` — File system operations (read, write, delete)
   * - `"code"` — Code execution, transpilation, analysis
   * - `"http"` — HTTP requests, REST/GraphQL API calls
   * - `"data"` — Data transformation, parsing, formatting
   * - `"system"` — Shell execution, OS-level operations
   * - `"custom"` — Application-specific tools
   *
   * @default undefined
   */
  category: Schema.optional(
    Schema.Literal("search", "file", "code", "http", "data", "system", "custom"),
  ),
  /**
   * Risk level of the tool — controls approval requirements and guardrail behavior.
   *
   * - `"low"` — Minor side effects, e.g. writing a local file
   * - `"medium"` — Significant side effects, e.g. HTTP POST, database writes
   * - `"high"` — Dangerous side effects, e.g. shell execution, running code
   * - `"critical"` — Destructive or irreversible, e.g. delete operations, financial transactions
   */
  riskLevel: Schema.Literal("low", "medium", "high", "critical"),
  /**
   * Maximum execution time in milliseconds before a `ToolTimeoutError` is thrown.
   *
   * Set based on expected tool latency. Typical values:
   * - Fast tools (file read/write): 5,000–10,000
   * - Network tools (web search, HTTP): 30,000
   * - Code execution: 30,000–60,000
   *
   * @example `30_000` (30 seconds)
   */
  timeoutMs: Schema.Number,
  /**
   * Whether a human must approve execution before the tool runs.
   *
   * When `true`, the InteractionManager approval gate blocks until
   * a human calls `resolveApproval()`. Use for high-risk or irreversible actions.
   *
   * @default false
   */
  requiresApproval: Schema.Boolean,
  /**
   * Origin of the tool — indicates where the implementation comes from.
   *
   * - `"builtin"` — Built into the framework (file-write, web-search, code-execute, etc.)
   * - `"mcp"` — Dynamically registered from an MCP (Model Context Protocol) server
   * - `"function"` — Registered via `ToolService.register()` as a function handler
   * - `"plugin"` — Loaded from an external plugin package
   */
  source: Schema.Literal("builtin", "mcp", "function", "plugin"),
  /**
   * Whether results from this tool can be cached for identical inputs.
   *
   * Side-effecting tools (file-write, code-execute, send-email) should set this to `false`.
   * Read-only or deterministic tools (web-search, file-read, http-get) benefit from caching.
   *
   * @default undefined (cache service decides based on tool name)
   */
  isCacheable: Schema.optional(Schema.Boolean),
  /**
   * Custom TTL in milliseconds for cached results of this tool.
   *
   * Overrides the cache service's `defaultTtlMs`. Only relevant when caching is enabled.
   *
   * @default undefined (uses cache default, typically 300_000 = 5 min)
   */
  cacheTtlMs: Schema.optional(Schema.Number),
});

/**
 * A complete tool definition with metadata.
 *
 * Tools are the actions an agent can take. Each tool has:
 * - Metadata: name, description, category, source
 * - Input schema: array of parameters with types and constraints
 * - Risk/control: riskLevel, timeoutMs, requiresApproval flag
 *
 * @remarks
 * The `category` field helps with discovery and filtering:
 * - `"search"`: Web search, document retrieval
 * - `"file"`: File system operations (read, write, delete)
 * - `"code"`: Code execution, transpilation, analysis
 * - `"http"`: HTTP requests, API calls
 * - `"data"`: Data transformation, parsing, formatting
 * - `"custom"`: Application-specific tools
 *
 * The `source` field indicates where the tool comes from:
 * - `"builtin"`: Built into the framework (file-write, web-search, etc.)
 * - `"mcp"`: From an MCP (Model Context Protocol) server
 * - `"function"`: Registered as a function handler
 * - `"plugin"`: From a plugin package
 *
 * @example
 * ```typescript
 * const toolDef: ToolDefinition = {
 *   name: "web-search",
 *   description: "Search the web (Tavily, Brave, or DuckDuckGo fallback)",
 *   parameters: [
 *     { name: "query", type: "string", description: "Search query", required: true },
 *     { name: "maxResults", type: "number", description: "Max results (1-10)", required: false },
 *   ],
 *   returnType: "{ results: [{ title, url, content }] }",
 *   category: "search",
 *   riskLevel: "low",
 *   timeoutMs: 30_000,
 *   requiresApproval: false,
 *   source: "builtin",
 * };
 * ```
 *
 * @see {@link ToolService.register} to register custom tools
 * @see {@link ToolService.listTools} to discover tools
 */
export type ToolDefinition = typeof ToolDefinitionSchema.Type;

// ─── Tool Execution ───

/**
 * Schema for a tool execution request.
 *
 * Specifies the tool to execute, its input arguments, and execution context.
 *
 * @see {@link ToolInput} for the TypeScript type
 */
export const ToolInputSchema = Schema.Struct({
  /** Name of the tool to invoke — must match a registered tool's `name` field. */
  toolName: Schema.String,
  /**
   * Arguments to pass to the tool, keyed by parameter name.
   *
   * These are validated against the tool's `parameters` schema before execution.
   * Each key should match a `ToolParameter.name` from the tool definition.
   */
  arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  /** ID of the agent invoking the tool — used for audit logging and EventBus events. */
  agentId: Schema.String,
  /** Session ID for grouping related tool calls — used for correlation and tracing. */
  sessionId: Schema.String,
  /**
   * Optional correlation ID for distributed tracing across services.
   *
   * Propagated to EventBus `ToolCallCompleted` events and observability spans.
   *
   * @default undefined
   */
  correlationId: Schema.optional(Schema.String),
});

/**
 * A tool execution request.
 *
 * Sent to `ToolService.execute()` to invoke a tool with arguments.
 * Includes the agent and session context for audit logging and correlation.
 *
 * @remarks
 * Arguments are validated against the tool's parameter schema before execution.
 * The `correlationId` (optional) is used for tracing across distributed systems.
 *
 * @example
 * ```typescript
 * const input: ToolInput = {
 *   toolName: "web-search",
 *   arguments: { query: "TypeScript tutorials", maxResults: 5 },
 *   agentId: "my-agent",
 *   sessionId: "session-abc123",
 *   correlationId: "trace-xyz789",
 * };
 * const output = yield* toolService.execute(input);
 * ```
 *
 * @see {@link ToolService.execute}
 */
export type ToolInput = typeof ToolInputSchema.Type;

/**
 * Schema for a tool execution result.
 *
 * Returned by `ToolService.execute()` with success status, result, and timing.
 *
 * @see {@link ToolOutput} for the TypeScript type
 */
export const ToolOutputSchema = Schema.Struct({
  /** Name of the tool that was executed — echoed from `ToolInput.toolName`. */
  toolName: Schema.String,
  /**
   * Whether the tool executed successfully.
   *
   * `true` — `result` contains the tool's output.
   * `false` — `error` contains a description of the failure.
   */
  success: Schema.Boolean,
  /**
   * The tool's output value.
   *
   * Shape depends on the tool. Common shapes:
   * - `file-write`: `{ written: true, path: string }`
   * - `web-search`: `{ results: [{ title, url, content }] }`
   * - `code-execute`: `{ executed: true, result: unknown, output: string }`
   *
   * `undefined` when `success: false`.
   */
  result: Schema.Unknown,
  /**
   * Error message when `success: false`.
   *
   * Human-readable description of the failure, including parameter hints
   * when the issue is a missing or invalid argument.
   *
   * @default undefined
   */
  error: Schema.optional(Schema.String),
  /**
   * Total execution time in milliseconds.
   *
   * Includes input validation, sandbox setup, execution, and EventBus publishing.
   * Use for performance monitoring and detecting slow tools.
   */
  executionTimeMs: Schema.Number,
  /**
   * Optional metadata from the tool execution.
   *
   * Tool implementations may include extra context here (e.g. HTTP status code,
   * bytes written, cache hit/miss). Not standardized across tools.
   *
   * @default undefined
   */
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

/**
 * Result of a tool execution.
 *
 * Contains the execution status, result data or error message, and timing metrics.
 * Always includes the tool name and execution time in milliseconds.
 *
 * @remarks
 * When `success: true`, the `result` field contains the tool's output.
 * When `success: false`, the `error` field contains a message describing the failure.
 *
 * Timing data (`executionTimeMs`) includes validation, execution, and sandbox overhead.
 *
 * @example
 * ```typescript
 * const output: ToolOutput = {
 *   toolName: "file-write",
 *   success: true,
 *   result: { written: true, path: "./output.txt" },
 *   executionTimeMs: 45,
 * };
 *
 * // Error example:
 * const errorOutput: ToolOutput = {
 *   toolName: "file-read",
 *   success: false,
 *   result: undefined,
 *   error: "File not found: ./missing.txt",
 *   executionTimeMs: 12,
 * };
 * ```
 *
 * @see {@link ToolService.execute}
 */
export type ToolOutput = typeof ToolOutputSchema.Type;

// ─── MCP Types ───

/**
 * Schema for an MCP tool schema entry.
 *
 * Describes a tool available from an MCP server, including its name,
 * description, and JSON Schema for input parameters.
 */
export const MCPToolSchemaEntry = Schema.Struct({
  /** Tool name as reported by the MCP server (without server prefix). */
  name: Schema.String,
  /** Human-readable description of the tool from the MCP server. @default undefined */
  description: Schema.optional(Schema.String),
  /**
   * JSON Schema object describing the tool's input parameters.
   *
   * Contains `type`, `properties`, and `required` fields per JSON Schema spec.
   * Converted to `ToolParameter[]` format when registered in the tool registry.
   *
   * @default undefined
   */
  inputSchema: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

/**
 * MCP tool schema entry type (from server discovery).
 *
 * Used internally to represent tools exposed by MCP servers before
 * conversion to standard ToolDefinition format.
 *
 * @see {@link MCPServer}
 */
export type MCPToolSchema = typeof MCPToolSchemaEntry.Type;

/**
 * Schema for an MCP server instance.
 *
 * Represents a connected or disconnected Model Context Protocol server
 * with its configuration, available tools, and connection status.
 */
export const MCPServerSchema = Schema.Struct({
  /** Unique server name used to prefix tool names and identify the connection. */
  name: Schema.String,
  /** Server protocol version string (e.g. `"1.0.0"`). */
  version: Schema.String,
  /**
   * Transport mechanism used to communicate with the MCP server.
   *
   * - `"stdio"` — Child process with stdin/stdout JSON-RPC communication
   * - `"sse"` — HTTP Server-Sent Events streaming (one-way server push)
   * - `"websocket"` — Full-duplex WebSocket bidirectional communication
   */
  transport: Schema.Literal("stdio", "sse", "websocket", "streamable-http"),
  /**
   * HTTP endpoint URL for `"sse"` or `"websocket"` transports.
   *
   * Not applicable for `"stdio"` transport.
   *
   * @default undefined
   * @example `"http://localhost:3001/mcp"`
   */
  endpoint: Schema.optional(Schema.String),
  /**
   * Command to spawn for `"stdio"` transport.
   *
   * The executable path or name (e.g. `"node"`, `"python"`).
   *
   * @default undefined
   * @example `"node"`
   */
  command: Schema.optional(Schema.String),
  /**
   * Arguments for the `command` when using `"stdio"` transport.
   *
   * @default undefined
   * @example `["./mcp-filesystem-server.js", "--root", "/tmp"]`
   */
  args: Schema.optional(Schema.Array(Schema.String)),
  /**
   * Working directory for the subprocess (for `"stdio"` transport).
   *
   * @default undefined (inherits parent cwd)
   */
  cwd: Schema.optional(Schema.String),
  /**
   * Extra environment variables merged on top of the parent process environment
   * (for `"stdio"` transport).
   *
   * @default undefined
   * @example `{ GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_..." }`
   */
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  /**
   * HTTP headers sent with every request (for `"sse"` transport).
   *
   * Use for Bearer tokens, API keys, or any other per-server auth.
   *
   * @default undefined
   * @example `{ Authorization: "Bearer ghp_..." }`
   */
  headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  /**
   * List of tool names available from this server.
   *
   * Names do NOT include the server prefix here; they are prefixed with
   * `"{serverName}/"` when registered in the tool registry.
   */
  tools: Schema.Array(Schema.String),
  /**
   * Full tool schema entries from server discovery.
   *
   * Parallel to `tools` array — each entry contains the name, description,
   * and `inputSchema` for the corresponding tool at the same index.
   *
   * @default undefined
   */
  toolSchemas: Schema.optional(Schema.Array(MCPToolSchemaEntry)),
  /**
   * Current connection status of the MCP server.
   *
   * - `"connected"` — Server is reachable and tools are available
   * - `"disconnected"` — Server has been disconnected; tools are unregistered
   * - `"error"` — Connection failed or lost; check server logs
   */
  status: Schema.Literal("connected", "disconnected", "error"),
});

/**
 * An MCP (Model Context Protocol) server instance.
 *
 * Represents a server connection that exposes tools via JSON-RPC.
 *
 * @remarks
 * Transport types:
 * - `"stdio"`: Child process with stdin/stdout communication
 * - `"sse"`: Server-Sent Events HTTP streaming
 * - `"websocket"`: WebSocket bidirectional communication
 *
 * When `status: "connected"`, the server is available for tool discovery and invocation.
 * Tool names are prefixed with `{serverName}/` to distinguish them from other sources.
 *
 * @example
 * ```typescript
 * const server: MCPServer = {
 *   name: "filesystem",
 *   version: "1.0.0",
 *   transport: "stdio",
 *   command: "node",
 *   args: ["./mcp-server.js"],
 *   tools: ["read-file", "write-file", "list-dir"],
 *   status: "connected",
 * };
 * ```
 *
 * @see {@link ToolService.connectMCPServer}
 */
export type MCPServer = typeof MCPServerSchema.Type;

/**
 * Schema for an MCP JSON-RPC 2.0 request.
 *
 * Used for tool invocation and server communication over MCP transport.
 */
export const MCPRequestSchema = Schema.Struct({
  /** JSON-RPC protocol version — always `"2.0"`. */
  jsonrpc: Schema.Literal("2.0"),
  /** Request identifier for correlating the response. May be a string or number. */
  id: Schema.Union(Schema.String, Schema.Number),
  /** RPC method name (e.g. `"tools/call"`, `"tools/list"`). */
  method: Schema.String,
  /**
   * Method-specific parameters.
   *
   * For `"tools/call"`, this contains `{ name: string, arguments: Record<string, unknown> }`.
   *
   * @default undefined
   */
  params: Schema.optional(Schema.Unknown),
});

/**
 * An MCP JSON-RPC 2.0 request.
 *
 * Sent from client to MCP server to invoke a method or tool.
 * The `id` is used to correlate the request with the response.
 *
 * @remarks
 * The `method` typically corresponds to an MCP-defined RPC method or tool name.
 * Parameters are tool-specific and validated by the server.
 */
export type MCPRequest = typeof MCPRequestSchema.Type;

/**
 * Schema for an MCP JSON-RPC 2.0 response.
 *
 * Returned by an MCP server in response to a request.
 */
export const MCPResponseSchema = Schema.Struct({
  /** JSON-RPC protocol version — always `"2.0"`. */
  jsonrpc: Schema.Literal("2.0"),
  /** Response identifier — matches the `id` from the originating request. */
  id: Schema.Union(Schema.String, Schema.Number),
  /**
   * Successful result payload from the server.
   *
   * Present when the method succeeded. Shape is method-specific.
   *
   * @default undefined
   */
  result: Schema.optional(Schema.Unknown),
  /**
   * Error descriptor when the method failed.
   *
   * Present instead of `result` when the server encountered an error.
   * `code` follows JSON-RPC conventions (e.g. `-32600` = Invalid Request,
   * `-32601` = Method Not Found, `-32602` = Invalid Params).
   *
   * @default undefined
   */
  error: Schema.optional(
    Schema.Struct({
      /** JSON-RPC error code — negative integers; see JSON-RPC 2.0 spec. */
      code: Schema.Number,
      /** Human-readable error description. */
      message: Schema.String,
      /** Optional additional data about the error (stack trace, details). @default undefined */
      data: Schema.optional(Schema.Unknown),
    }),
  ),
});

/**
 * An MCP JSON-RPC 2.0 response.
 *
 * Received from an MCP server in response to a request.
 * Either `result` (success) or `error` (failure) is present.
 *
 * @remarks
 * The `id` matches the request ID for request-response correlation.
 * Error codes follow JSON-RPC conventions (e.g., -32600 = Invalid Request).
 */
export type MCPResponse = typeof MCPResponseSchema.Type;

// ─── Function Calling (Anthropic/OpenAI format) ───

/**
 * Schema for a function calling tool (Anthropic/OpenAI format).
 *
 * Used to represent tools in the standardized format expected by Claude,
 * ChatGPT, and other frontier language models for function calling.
 */
export const FunctionCallingToolSchema = Schema.Struct({
  /** Tool name exactly as registered — passed back in LLM tool_use responses. */
  name: Schema.String,
  /** Tool description shown to the LLM. Must be concise and actionable. */
  description: Schema.String,
  /**
   * JSON Schema object describing the tool's input parameters.
   *
   * Structure:
   * ```json
   * {
   *   "type": "object",
   *   "properties": {
   *     "param1": { "type": "string", "description": "..." }
   *   },
   *   "required": ["param1"]
   * }
   * ```
   *
   * Generated automatically by `ToolService.toFunctionCallingFormat()` from
   * the tool's `parameters` array.
   */
  input_schema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

/**
 * A tool in function calling format (Anthropic/OpenAI compatible).
 *
 * This is the format injected into LLM prompts so the model can discover
 * and invoke tools. The `input_schema` is a JSON Schema object describing
 * the tool's parameters.
 *
 * @remarks
 * This type is used internally by reasoning strategies when constructing
 * prompts. `ToolService.toFunctionCallingFormat()` converts all registered
 * tools to this format for LLM consumption.
 *
 * The `input_schema` has this structure:
 * ```json
 * {
 *   "type": "object",
 *   "properties": {
 *     "param1": { "type": "string", "description": "..." },
 *     "param2": { "type": "number", "description": "..." }
 *   },
 *   "required": ["param1"]
 * }
 * ```
 *
 * @example
 * ```typescript
 * const fcTool: FunctionCallingTool = {
 *   name: "web-search",
 *   description: "Search the web",
 *   input_schema: {
 *     type: "object",
 *     properties: {
 *       query: { type: "string", description: "Search query" },
 *     },
 *     required: ["query"],
 *   },
 * };
 * ```
 *
 * @see {@link ToolService.toFunctionCallingFormat}
 */
export type FunctionCallingTool = typeof FunctionCallingToolSchema.Type;

// ─── Result Compression Config ───

/**
 * Configuration for tool result compression behavior.
 *
 * Controls how large tool outputs are truncated, previewed, and stored
 * to keep the agent context window manageable.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withTools({
 *     resultCompression: {
 *       budget: 2000,
 *       previewItems: 8,
 *       autoStore: true,
 *       codeTransform: true,
 *     }
 *   })
 *   .build();
 * ```
 */
export interface ResultCompressionConfig {
  /** Chars before overflow triggers. Default: 800 */
  readonly budget?: number;
  /** Array items shown in preview. Default: 3 */
  readonly previewItems?: number;
  /** Auto-store overflow in scratchpad. Default: true */
  readonly autoStore?: boolean;
  /** Enable | transform: pipe syntax. Default: true */
  readonly codeTransform?: boolean;
}
