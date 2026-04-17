import { Effect, Ref } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

import { webSearchTool, webSearchHandler } from "./web-search.js";
import { cryptoPriceTool, cryptoPriceHandler } from "./crypto-price.js";
import { httpGetTool, httpGetHandler } from "./http-client.js";
import { fileReadTool, fileReadHandler } from "./file-operations.js";
import { fileWriteTool, fileWriteHandler } from "./file-operations.js";
import { codeExecuteTool, codeExecuteHandler } from "./code-execution.js";
import {
  scratchpadWriteTool,
  scratchpadReadTool,
  makeScratchpadWriteHandler,
  makeScratchpadReadHandler,
} from "./scratchpad.js";
import { contextStatusTool, makeContextStatusHandler } from "./context-status.js";
import { taskCompleteTool, makeTaskCompleteHandler } from "./task-complete.js";
import { finalAnswerTool } from "./final-answer.js";
import type { RagMemoryStore } from "./rag-ingest.js";
import {
  ragSearchTool,
  makeRagSearchHandler,
  makeInMemorySearchCallback,
} from "./rag-search.js";
import { recallTool, makeRecallHandler, type RecallConfig } from "./recall.js";
import { findTool, makeFindHandler, type FindConfig, type FindState } from "./find.js";
import { checkpointTool, makeCheckpointHandler, type CheckpointConfig } from "./checkpoint.js";
import { briefTool, buildBriefResponse, computeEntropyGrade, type BriefInput } from "./brief.js";
import { pulseTool, buildPulseResponse, type PulseInput } from "./pulse.js";
import {
  shellExecuteTool,
  shellExecuteHandler,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  type ShellExecuteConfig,
  type ShellAuditEntry,
} from "./shell-execution.js";

// Re-export meta-tool factories and types so callers can wire up dynamic state
export {
  contextStatusTool,
  makeContextStatusHandler,
  type ContextStatusState,
} from "./context-status.js";
export {
  taskCompleteTool,
  makeTaskCompleteHandler,
  shouldShowTaskComplete,
  type TaskCompleteState,
  type TaskCompleteVisibility,
} from "./task-complete.js";
export {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerState,
  type FinalAnswerVisibility,
  type FinalAnswerCapture,
} from "./final-answer.js";
export {
  ragIngestTool,
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
  type RagStoreCallback,
  type RagMemoryStore,
} from "./rag-ingest.js";
export {
  ragSearchTool,
  makeRagSearchHandler,
  makeInMemorySearchCallback,
  type RagSearchCallback,
  type RagSearchResult,
} from "./rag-search.js";
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./recall.js";
export {
  findTool,
  makeFindHandler,
  type FindConfig,
  type FindState,
} from "./find.js";
export {
  checkpointTool,
  makeCheckpointHandler,
  type CheckpointConfig,
} from "./checkpoint.js";
export {
  briefTool,
  buildBriefResponse,
  computeEntropyGrade,
  type BriefInput,
} from "./brief.js";
export {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "./pulse.js";
export {
  shellExecuteTool,
  shellExecuteHandler,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  isCommandAllowed,
  isCommandBlocked,
  sanitizeCommand,
  type ShellExecuteConfig,
  type ShellAuditEntry,
} from "./shell-execution.js";

// Shared scratchpad store — one per tool service instance (reset per agent run).
// Exported so the reasoning kernel can sync scratchpad state after tool execution.
export const scratchpadStoreRef = Ref.unsafeMake(new Map<string, string>());

// Shared checkpoint store — separate from scratchpad/recall to survive context compaction.
// Exported so the reasoning kernel can auto-checkpoint before compaction.
export const checkpointStoreRef = Ref.unsafeMake(new Map<string, string>());

// Shared RAG in-memory store — one per tool service instance (reset per agent run).
// Exported so that the runtime builder can pre-populate it via .withDocuments() / agent.ingest().
export const ragMemoryStore: RagMemoryStore = new Map();

/**
 * Capability tools auto-registered when ToolServiceLive is created.
 *
 * These are the agent's task tools — what it uses to accomplish work.
 * Framework infrastructure tools (recall, find, brief, pulse, scratchpad-*,
 * rag-search, final-answer, etc.) are registered separately by the kernel
 * with live state, or are conductor tools injected via .withMetaTools().
 *
 * scratchpad-write/read removed: superseded by recall (richer API).
 * rag-search removed: superseded by find (unified routing).
 */
export const builtinTools: ReadonlyArray<{
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}> = [
  { definition: webSearchTool, handler: webSearchHandler },
  { definition: cryptoPriceTool, handler: cryptoPriceHandler },
  { definition: httpGetTool, handler: httpGetHandler },
  { definition: fileReadTool, handler: fileReadHandler },
  { definition: fileWriteTool, handler: fileWriteHandler },
  { definition: codeExecuteTool, handler: codeExecuteHandler },
];

/**
 * Meta-tool definitions (no default handlers — must be wired with live state).
 * Exported for schema inspection, documentation, and dynamic registration.
 */
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  taskCompleteTool,
  finalAnswerTool,
  briefTool,
  findTool,
  pulseTool,
  recallTool,
  checkpointTool,
];
