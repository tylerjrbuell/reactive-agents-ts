/**
 * A2A Protocol Types — based on the Agent2Agent (A2A) specification.
 * See: https://a2a-protocol.org/latest/specification/
 *
 * All types use Effect Schema.Struct following Reactive Agents conventions.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

export const A2A_PROTOCOL_VERSION = "0.3.0";

// ---------------------------------------------------------------------------
// Part types — content within Messages and Artifacts
// ---------------------------------------------------------------------------

export const TextPartSchema = Schema.Struct({
  kind: Schema.Literal("text"),
  text: Schema.String,
  mimeType: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type TextPart = typeof TextPartSchema.Type;

export const FileContentSchema = Schema.Struct({
  uri: Schema.optional(Schema.String),
  mimeType: Schema.String,
  name: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String), // base64-encoded
  sizeBytes: Schema.optional(Schema.Number),
});
export type FileContent = typeof FileContentSchema.Type;

export const FilePartSchema = Schema.Struct({
  kind: Schema.Literal("file"),
  file: FileContentSchema,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type FilePart = typeof FilePartSchema.Type;

export const DataPartSchema = Schema.Struct({
  kind: Schema.Literal("data"),
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  schema: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  mimeType: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type DataPart = typeof DataPartSchema.Type;

export const PartSchema = Schema.Union(
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
);
export type Part = typeof PartSchema.Type;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const A2ARoleSchema = Schema.Literal("user", "agent");
export type A2ARole = typeof A2ARoleSchema.Type;

export const A2AMessageSchema = Schema.Struct({
  role: A2ARoleSchema,
  parts: Schema.Array(PartSchema),
  messageId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  contextId: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String), // ISO 8601
  referenceTaskIds: Schema.optional(Schema.Array(Schema.String)),
  extensions: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type A2AMessage = typeof A2AMessageSchema.Type;

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export const ArtifactSchema = Schema.Struct({
  artifactId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  parts: Schema.Array(PartSchema),
  mimeType: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  createdAt: Schema.optional(Schema.String),
  extensions: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type Artifact = typeof ArtifactSchema.Type;

// ---------------------------------------------------------------------------
// Task state and status
// ---------------------------------------------------------------------------

export const TaskStateSchema = Schema.Literal(
  "submitted",
  "working",
  "input_required",
  "completed",
  "failed",
  "canceled",
  "rejected",
  "unknown",
);
export type TaskState = typeof TaskStateSchema.Type;

export const A2ATaskStatusSchema = Schema.Struct({
  state: TaskStateSchema,
  message: Schema.optional(Schema.String),
  timestamp: Schema.String, // ISO 8601
  errorCode: Schema.optional(Schema.String),
});
export type A2ATaskStatus = typeof A2ATaskStatusSchema.Type;

// ---------------------------------------------------------------------------
// A2A Task
// ---------------------------------------------------------------------------

export const A2ATaskSchema = Schema.Struct({
  id: Schema.String,
  contextId: Schema.optional(Schema.String),
  status: A2ATaskStatusSchema,
  artifacts: Schema.optional(Schema.Array(ArtifactSchema)),
  history: Schema.optional(Schema.Array(A2AMessageSchema)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  extensions: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  kind: Schema.optional(Schema.Literal("task")),
});
export type A2ATask = typeof A2ATaskSchema.Type;

// ---------------------------------------------------------------------------
// Streaming event types
// ---------------------------------------------------------------------------

export const TaskStatusUpdateEventSchema = Schema.Struct({
  taskId: Schema.String,
  contextId: Schema.optional(Schema.String),
  status: A2ATaskStatusSchema,
  final: Schema.optional(Schema.Boolean),
  kind: Schema.Literal("status-update"),
});
export type TaskStatusUpdateEvent = typeof TaskStatusUpdateEventSchema.Type;

export const TaskArtifactUpdateEventSchema = Schema.Struct({
  taskId: Schema.String,
  contextId: Schema.optional(Schema.String),
  artifact: ArtifactSchema,
  append: Schema.optional(Schema.Boolean),
  lastChunk: Schema.optional(Schema.Boolean),
  kind: Schema.Literal("artifact-update"),
});
export type TaskArtifactUpdateEvent =
  typeof TaskArtifactUpdateEventSchema.Type;

// ---------------------------------------------------------------------------
// Agent Card — capability discovery
// ---------------------------------------------------------------------------

export const AgentProviderSchema = Schema.Struct({
  organization: Schema.String,
  url: Schema.optional(Schema.String),
});
export type AgentProvider = typeof AgentProviderSchema.Type;

export const AgentSkillSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  examples: Schema.optional(Schema.Array(Schema.String)),
  inputModes: Schema.optional(Schema.Array(Schema.String)),
  outputModes: Schema.optional(Schema.Array(Schema.String)),
});
export type AgentSkill = typeof AgentSkillSchema.Type;

export const AgentCapabilitiesSchema = Schema.Struct({
  streaming: Schema.optional(Schema.Boolean),
  pushNotifications: Schema.optional(Schema.Boolean),
  stateTransitionHistory: Schema.optional(Schema.Boolean),
  extensions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        uri: Schema.String,
        description: Schema.optional(Schema.String),
        required: Schema.optional(Schema.Boolean),
        params: Schema.optional(
          Schema.Record({ key: Schema.String, value: Schema.Unknown }),
        ),
      }),
    ),
  ),
});
export type AgentCapabilities = typeof AgentCapabilitiesSchema.Type;

export const AgentInterfaceSchema = Schema.Struct({
  url: Schema.String,
  transport: Schema.Literal("JSONRPC", "GRPC", "HTTP+JSON"),
});
export type AgentInterface = typeof AgentInterfaceSchema.Type;

export const SecuritySchemeSchema = Schema.Struct({
  type: Schema.Literal(
    "apiKey",
    "http",
    "oauth2",
    "openIdConnect",
    "mutualTls",
  ),
  name: Schema.optional(Schema.String),
  in: Schema.optional(Schema.Literal("header", "query", "cookie")),
  scheme: Schema.optional(Schema.String),
  openIdConnectUrl: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});
export type SecurityScheme = typeof SecuritySchemeSchema.Type;

export const AgentCardSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.String,
  protocolVersion: Schema.optional(Schema.String),
  url: Schema.String,
  provider: AgentProviderSchema,
  capabilities: AgentCapabilitiesSchema,
  skills: Schema.optional(Schema.Array(AgentSkillSchema)),
  interfaces: Schema.optional(Schema.Array(AgentInterfaceSchema)),
  defaultInputModes: Schema.optional(Schema.Array(Schema.String)),
  defaultOutputModes: Schema.optional(Schema.Array(Schema.String)),
  securitySchemes: Schema.optional(
    Schema.Record({ key: Schema.String, value: SecuritySchemeSchema }),
  ),
  security: Schema.optional(
    Schema.Array(
      Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }),
    ),
  ),
  extensions: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type AgentCard = typeof AgentCardSchema.Type;

// ---------------------------------------------------------------------------
// JSON-RPC 2.0
// ---------------------------------------------------------------------------

export const JsonRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
  id: Schema.Union(Schema.String, Schema.Number, Schema.Null),
});
export type JsonRpcRequest = typeof JsonRpcRequestSchema.Type;

export const JsonRpcResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optional(Schema.Unknown),
    }),
  ),
  id: Schema.Union(Schema.String, Schema.Number, Schema.Null),
});
export type JsonRpcResponse = typeof JsonRpcResponseSchema.Type;

// ---------------------------------------------------------------------------
// Method params
// ---------------------------------------------------------------------------

export const SendMessageParamsSchema = Schema.Struct({
  message: A2AMessageSchema,
  configuration: Schema.optional(
    Schema.Struct({
      acceptedOutputModes: Schema.optional(Schema.Array(Schema.String)),
      historyLength: Schema.optional(Schema.Number),
      blocking: Schema.optional(Schema.Boolean),
    }),
  ),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type SendMessageParams = typeof SendMessageParamsSchema.Type;

export const TaskQueryParamsSchema = Schema.Struct({
  id: Schema.String,
  historyLength: Schema.optional(Schema.Number),
});
export type TaskQueryParams = typeof TaskQueryParamsSchema.Type;

export const TaskCancelParamsSchema = Schema.Struct({
  id: Schema.String,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type TaskCancelParams = typeof TaskCancelParamsSchema.Type;

// ---------------------------------------------------------------------------
// A2A server configuration
// ---------------------------------------------------------------------------

export const A2AServerConfigSchema = Schema.Struct({
  port: Schema.Number,
  hostname: Schema.optional(Schema.String),
  basePath: Schema.optional(Schema.String),
});
export type A2AServerConfig = typeof A2AServerConfigSchema.Type;
