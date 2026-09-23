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
  ToolDefinitionError,
  ToolTimeoutError,
  ToolOutputValidationError,
  ToolValidationError,
  MCPConnectionError,
  ToolAuthorizationError,
  toToolError,
} from "./errors.js";

// ─── Services ───
export { ToolService, ToolServiceLive } from "./tool-service.js";

// ─── Registry ───
export { makeToolRegistry } from "./registry/tool-registry.js";
export type { RegisteredTool } from "./registry/tool-registry.js";

// ─── MCP Client ───
export {
  makeMCPClient,
  cleanupMcpTransport,
  buildMcpSubprocessEnv,
  validateAuthEndpointIsHttps,
} from "./mcp/mcp-client.js";

// ─── MCP Client OAuth (Task 2, 2026-09-17) ───
export type {
  MCPAuthConfig,
  MCPTokenStore,
  StoredMcpCredentials,
  OAuthDiscoveryState,
} from "./mcp/auth/types.js";
export {
  canonicalResourceKey,
  createMemoryTokenStore,
  createFileTokenStore,
  DEFAULT_MCP_AUTH_DIR,
} from "./mcp/auth/token-store.js";
// Provider construction (Task 3/4/5) + the CVE-2025-6514-hardened browser
// opener (Task 4) — surfaced here so `apps/cli`'s `rax mcp login|logout`
// (Task 6) can build/drive the exact same provider `mcp-client.ts`'s
// `connect()` uses, instead of re-deriving auth-provider construction.
export { createAuthProvider } from "./mcp/auth/create-provider.js";
export { openBrowser } from "./mcp/auth/open-browser.js";
export {
  hasRedactor,
  isHttpsOrLoopback,
  type HardenedProviderExtras,
} from "./mcp/auth/hardened-provider.js";

// ─── MCP Toolkit Registry (2026-09-19) ───
// Resolves a public catalog entry name (Docker Hub's `mcp/*` first) into a
// connect-ready MCP server config, gated by a digest-keyed local approval
// store. See wiki/Architecture/Design-Specs/2026-09-19-mcp-toolkit-scaffolding.md.
export {
  MCPVolumeMountSchema,
  MCPToolkitRequestSchema,
  MCPMissingEnvVarError,
  MCPApprovalRequiredError,
  MCPDigestMismatchError,
  MCPRegistryFetchError,
  MCPApprovalStore,
  MCPApprovalStoreError,
  MCPApprovalStoreLive,
  makeFileApprovalStore,
  buildApprovalKey,
  DEFAULT_MCP_APPROVALS_PATH,
  approveMcpImage,
  isMcpImageApproved,
  DockerHubHttp,
  DockerHubHttpLive,
  DockerHubMCPRegistry,
  resolveDockerHubToolkitRequest,
  defaultRegistries,
} from "./mcp/registry/index.js";
export type {
  MCPVolumeMount,
  MCPToolkitRequest,
  MCPRegistryServerConfig,
  MCPRegistry,
  MCPApprovalRecord,
  DockerHubRepositoryResponse,
  DockerHubMCPRegistryOptions,
} from "./mcp/registry/index.js";

// ─── Scratchpad spill (#47) ───
export {
  setScratchpadBounded,
  resolveScratchpadValue,
  DEFAULT_SCRATCHPAD_SPILL_THRESHOLD_BYTES,
} from "./scratchpad-spill.js";

// ─── Function Calling ───
export {
  adaptFunction,
  toFunctionCallingTool,
} from "./function-calling/function-adapter.js";

// ─── Execution ───
export { makeSandbox } from "./execution/sandbox.js";
export {
  makeDockerSandbox,
  buildSandboxImage,
  DEFAULT_DOCKER_CONFIG,
  RUNNER_IMAGES,
  SANDBOX_IMAGES,
  getSeccompProfilePath,
} from "./execution/docker-sandbox.js";
export type {
  DockerSandboxConfig,
  DockerSandbox,
  DockerExecResult,
  RunnerLanguage,
} from "./execution/docker-sandbox.js";

// ─── Validation ───
export { validateToolInput } from "./validation/input-validator.js";

// ─── Artifact truth (Wave C / C2) ───
export {
  resolveProduces,
  extractArtifactFacts,
  type ProducesKind,
  type ArtifactFact,
} from "./artifacts/artifact-contract.js";

// ─── Skills ───
export {
  builtinTools,
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOLSET_ALIASES,
  resolveBuiltinNames,
  metaToolDefinitions,
  ragMemoryStore,
  scratchpadStoreRef,
  checkpointStoreRef,
  discoveredToolsStoreRef,
} from "./skills/builtin.js";
export {
  webSearchTool,
  webSearchHandler,
  type WebSearchHandlerResult,
  type WebSearchProvider,
  type WebSearchResultRow,
} from "./skills/web-search.js";
export {
  fileReadTool,
  fileReadHandler,
  fileWriteTool,
  fileWriteHandler,
  fileEditTool,
  fileEditHandler,
  listDirectoryTool,
  listDirectoryHandler,
  withFileRoot,
  getFileRoot,
} from "./skills/file-operations.js";
export { httpGetTool, httpGetHandler, type HttpGetConfig } from "./skills/http-client.js";
export { grepTool, grepHandler } from "./skills/grep.js";
// Pure result renderer (shared by reasoning ContextManager consumers).
export { renderValue, describeShape, asArray, type ResultFormat } from "./skills/render-result.js";
export {
  codeExecuteTool,
  codeExecuteHandler,
  type CodeExecuteConfig,
} from "./skills/code-execution.js";
export {
  dockerExecuteTool,
  makeDockerExecuteHandler,
} from "./skills/docker-execution.js";
export {
  shellExecuteTool,
  shellExecuteHandler,
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_BLOCKED_PATTERNS,
  DEFAULT_BLOCKED_RULES,
  OPT_IN_COMMANDS,
  isCommandAllowed,
  isCommandBlocked,
  findBlockedReason,
  findDisallowedCommand,
  sanitizeCommand,
  type BlockedCommandRule,
  type ShellExecuteConfig,
  type ShellAuditEntry,
} from "./skills/shell-execution.js";

export {
  scratchpadWriteTool,
  scratchpadReadTool,
  makeScratchpadStore,
  makeScratchpadWriteHandler,
  makeScratchpadReadHandler,
} from "./skills/scratchpad.js";

// ─── Caching ───
export {
  ToolApprovalGate,
  definitionRequiresApproval,
  type ToolApprovalRequest,
  type ToolApprovalDecision,
} from "./governance/tool-approval-gate.js";
export { ToolResultCache, ToolResultCacheLive } from "./caching/index.js";
export type { ToolResultCacheConfig, ToolCacheStats } from "./caching/index.js";

// ─── Runtime ───
export { createToolsLayer, ToolsLayer } from "./runtime.js";

// ─── Adapters ───
export {
  createAgentTool,
  createRemoteAgentTool,
  createSpawnAgentTool,
  createSpawnAgentsTool,
  executeAgentTool,
  executeRemoteAgentTool,
  createSubAgentExecutor,
  buildParentContextPrefix,
  composeSubAgentDirectivePrompt,
  computeEffectiveTools,
  subAgentDepthRefusal,
  finalizeSubAgentResult,
  subAgentResultForDisplay,
  subAgentChildLedgerEntries,
  resolveMaxRecursionDepth,
  SUB_AGENT_DIRECTIVE,
  MAX_RECURSION_DEPTH,
  MAX_PARENT_CONTEXT_CHARS,
  ALWAYS_INCLUDE_TOOLS,
} from "./adapters/agent-tool-adapter.js";
export type { RemoteAgentClient, TaskResult, SubAgentConfig, SubAgentResult, SubAgentRawResult, ParentContext, ParentContextItem } from "./adapters/agent-tool-adapter.js";

export { fetchJsonTool, HttpToolError } from "./adapters/http-tool-adapter.js";
export type { HttpToolOptions } from "./adapters/http-tool-adapter.js";

// ─── Tool Calling Drivers ───
export { NativeFCDriver } from "./drivers/native-fc-driver.js"
export { TextParseDriver } from "./drivers/text-parse-driver.js"
export { selectToolCallingDriver } from "./drivers/select-driver.js"
export { extractRationale, parseRationaleBlocks, stripRationaleBlocks } from "./drivers/rationale-parser.js"
export type { ToolCallingDriver, ExtractedCall, HealingAction, HealingResult, ParseMode, ToolCallObservation } from "./drivers/tool-calling-driver.js"

// ─── Healing Pipeline ───
export { runHealingPipeline } from "./healing/healing-pipeline.js"

// ─── Judgment Healing Escalation (Task 12 — opt-in, ADD only) ───
export {
  runJudgmentHealing,
  buildJudgmentHealingState,
  buildJudgmentHealingQuestions,
} from "./healing/judgment-healing.js"

// ─── Builder ───
export { ToolBuilder } from "./tool-builder.js";

// ─── Schema-Inferred Tool Factory ───
export { defineTool } from "./define-tool.js";
export type {
  DefineToolOptions,
  DefinedTool,
  ToolSchema,
  ToolHandler,
} from "./define-tool.js";

// ─── Toolset (shared defaults factory) ───
export { defineToolset } from "./toolset.js";
export type { Toolset, ToolsetDefaults } from "./toolset.js";

// ─── Testing Helpers ───
export { testTool, mockFetchOnce } from "./testing.js";
export type { TestToolResult } from "./testing.js";

// ─── Tool Observability Envelope ───
export { withToolObservability, withToolRetry } from "./observability.js";
export type { ObservedToolResult, ToolObservabilityMeta } from "./observability.js";

// ─── Standard Schema (Zod / Valibot / ArkType interop) ───
export { isStandardSchema } from "./standard-schema.js";
export type { StandardSchemaV1 } from "./standard-schema.js";

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
  makeInMemorySearchCallback,
} from "./skills/rag-search.js";
export type { RagSearchCallback, RagSearchResult } from "./skills/rag-search.js";

// ─── Skill Meta-Tools ───
export {
  activateSkillTool,
  buildSkillContentXml,
  activateSkillHandler,
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
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  buildFinalAnswerDescription,
  buildFinalAnswerOutputDescription,
} from "./skills/final-answer.js";
export type {
  FinalAnswerVisibility,
  FinalAnswerState,
  FinalAnswerCapture,
  FinalAnswerDescriptionContext,
} from "./skills/final-answer.js";
export {
  requestUserInputTool,
  REQUEST_USER_INPUT_TOOL_NAME,
} from "./skills/request-user-input.js";

// ─── Completion Gaps Utility ───
export { detectCompletionGaps } from "./skills/completion-gaps.js";

// ─── Tool Call Resolver ───
export * from "./tool-calling/index.js";

// ─── Research Utilities ───
export { boundedMap } from "./research/bounded-parallel.js";
export type { BoundedMapResult } from "./research/bounded-parallel.js";
export { searchThenFetch } from "./research/search-then-fetch.js";
export type { SearchThenFetchOptions, SearchThenFetchResult } from "./research/search-then-fetch.js";
export { resolveThenRetrieve } from "./research/resolve-then-retrieve.js";
export type { ResolveThenRetrieveOptions } from "./research/resolve-then-retrieve.js";

// ─── Conductor's Suite Tools ───
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./skills/recall.js";
export {
  relateTool,
  makeRelateHandler,
  type RelateState,
  type RelateEntry,
} from "./skills/relate.js";
export {
  findTool,
  makeFindHandler,
  type FindConfig,
  type FindState,
} from "./skills/find.js";
export {
  checkpointTool,
  makeCheckpointHandler,
  type CheckpointConfig,
} from "./skills/checkpoint.js";
export {
  discoverToolsTool,
  makeDiscoverToolsHandler,
  type DiscoverToolsState,
} from "./skills/discover-tools.js";
export {
  todoTool,
  applyTodoAction,
  parseTodoList,
  renderTodoList,
  type TodoItem,
  type TodoActionResult,
} from "./skills/todo.js";
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
