// ─── Types ───
export type {
  ToolParameter,
  ToolDefinition,
  ToolInput,
  ToolOutput,
  MCPServer,
  MCPToolSchema,
  MCPRequest,
  MCPResponse,
  FunctionCallingTool,
} from "./types.js";

export {
  ToolParameterSchema,
  ToolDefinitionSchema,
  ToolInputSchema,
  ToolOutputSchema,
  MCPServerSchema,
  MCPRequestSchema,
  MCPResponseSchema,
  FunctionCallingToolSchema,
} from "./types.js";

// ─── Errors ───
export {
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
  MCPConnectionError,
  ToolAuthorizationError,
} from "./errors.js";

// ─── Services ───
export { ToolService, ToolServiceLive } from "./tool-service.js";

// ─── Registry ───
export { makeToolRegistry } from "./registry/tool-registry.js";
export type { RegisteredTool } from "./registry/tool-registry.js";

// ─── MCP Client ───
export { makeMCPClient } from "./mcp/mcp-client.js";

// ─── Function Calling ───
export {
  adaptFunction,
  toFunctionCallingTool,
} from "./function-calling/function-adapter.js";

// ─── Execution ───
export { makeSandbox } from "./execution/sandbox.js";

// ─── Validation ───
export { validateToolInput } from "./validation/input-validator.js";

// ─── Skills ───
export { builtinTools } from "./skills/builtin.js";
export { webSearchTool, webSearchHandler } from "./skills/web-search.js";
export {
  fileReadTool,
  fileReadHandler,
  fileWriteTool,
  fileWriteHandler,
} from "./skills/file-operations.js";
export { httpGetTool, httpGetHandler } from "./skills/http-client.js";
export {
  codeExecuteTool,
  codeExecuteHandler,
} from "./skills/code-execution.js";

// ─── Runtime ───
export { createToolsLayer, ToolsLayer } from "./runtime.js";
