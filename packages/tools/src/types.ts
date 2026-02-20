import { Schema } from "effect";

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
  endpoint: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
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
  input_schema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type FunctionCallingTool = typeof FunctionCallingToolSchema.Type;
