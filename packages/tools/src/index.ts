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
  ResultCompressionConfig,
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
export {
  makeDockerSandbox,
  DEFAULT_DOCKER_CONFIG,
  RUNNER_IMAGES,
} from "./execution/docker-sandbox.js";
export type {
  DockerSandboxConfig,
  DockerSandbox,
  DockerExecResult,
  RunnerLanguage,
} from "./execution/docker-sandbox.js";

// ─── Validation ───
export { validateToolInput } from "./validation/input-validator.js";

// ─── Skills ───
export {
  builtinTools,
  metaToolDefinitions,
  ragMemoryStore,
  scratchpadStoreRef,
} from "./skills/builtin.js";
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
export {
  dockerExecuteTool,
  makeDockerExecuteHandler,
} from "./skills/docker-execution.js";

export {
  scratchpadWriteTool,
  scratchpadReadTool,
  makeScratchpadStore,
  makeScratchpadWriteHandler,
  makeScratchpadReadHandler,
} from "./skills/scratchpad.js";

// ─── Caching ───
export { ToolResultCache, ToolResultCacheLive } from "./caching/index.js";
export type { ToolResultCacheConfig, ToolCacheStats } from "./caching/index.js";

// ─── Runtime ───
export { createToolsLayer, ToolsLayer } from "./runtime.js";

// ─── Adapters ───
export {
  createAgentTool,
  createRemoteAgentTool,
  createSpawnAgentTool,
  executeAgentTool,
  executeRemoteAgentTool,
  createSubAgentExecutor,
  buildParentContextPrefix,
  MAX_RECURSION_DEPTH,
  MAX_PARENT_CONTEXT_CHARS,
  ALWAYS_INCLUDE_TOOLS,
} from "./adapters/agent-tool-adapter.js";
export type { RemoteAgentClient, TaskResult, SubAgentConfig, SubAgentResult, ParentContext, ParentContextItem } from "./adapters/agent-tool-adapter.js";

// ─── Builder ───
export { ToolBuilder } from "./tool-builder.js";

// ─── Schema-Inferred Tool Factory ───
export { defineTool } from "./define-tool.js";
export type { DefineToolOptions, DefinedTool } from "./define-tool.js";

// ─── Simple Tool Wrapper ───
export { tool } from "./define-tool-simple.js";
export type { SimpleTool } from "./define-tool-simple.js";

// ─── RAG Pipeline ───
export type { DocumentChunk, ChunkConfig } from "./rag/types.js";
export {
  chunkDocument,
  chunkBySentences,
  chunkByMarkdownSections,
} from "./rag/chunker.js";
export {
  loadText,
  loadMarkdown,
  loadJSON,
  loadCSV,
  loadHTML,
  detectAndLoad,
} from "./rag/loaders.js";
export {
  ragIngestTool,
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
} from "./skills/rag-ingest.js";
export type { RagStoreCallback, RagMemoryStore } from "./skills/rag-ingest.js";
export {
  ragSearchTool,
  makeRagSearchHandler,
  makeInMemorySearchCallback,
} from "./skills/rag-search.js";
export type { RagSearchCallback, RagSearchResult } from "./skills/rag-search.js";

// ─── Skill Meta-Tools ───
export {
  activateSkillTool,
  buildSkillContentXml,
} from "./skills/activate-skill.js";
export {
  getSkillSectionTool,
  parseSections,
  getSkillSection,
} from "./skills/get-skill-section.js";

// ─── Meta-Tools ───
export {
  contextStatusTool,
  makeContextStatusHandler,
} from "./skills/context-status.js";
export type { ContextStatusState } from "./skills/context-status.js";
export {
  taskCompleteTool,
  shouldShowTaskComplete,
  makeTaskCompleteHandler,
} from "./skills/task-complete.js";
export type { TaskCompleteVisibility, TaskCompleteState } from "./skills/task-complete.js";
export {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
} from "./skills/final-answer.js";
export type { FinalAnswerVisibility, FinalAnswerState, FinalAnswerCapture } from "./skills/final-answer.js";

// ─── Completion Gaps Utility ───
export { detectCompletionGaps } from "./skills/completion-gaps.js";

// ─── Tool Call Resolver ───
export * from "./tool-calling/index.js";

// ─── Conductor's Suite Tools ───
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./skills/recall.js";
export {
  findTool,
  makeFindHandler,
  type FindConfig,
  type FindState,
} from "./skills/find.js";
export {
  briefTool,
  buildBriefResponse,
  computeEntropyGrade,
  mergeBriefAvailableSkills,
  type BriefInput,
  type BriefSkillEntry,
} from "./skills/brief.js";
export {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "./skills/pulse.js";
