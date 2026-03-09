import { Effect, Ref } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

import { webSearchTool, webSearchHandler } from "./web-search.js";
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

// Shared scratchpad store — one per tool service instance (reset per agent run)
const scratchpadStoreRef = Ref.unsafeMake(new Map<string, string>());

/**
 * All built-in tools paired with their handlers.
 * Registered automatically when ToolServiceLive is created.
 *
 * Note: context-status and task-complete are meta-tools that require
 * dynamic runtime state. They are exported separately via their factory
 * functions (makeContextStatusHandler / makeTaskCompleteHandler) so the
 * execution engine can wire in live state. They are NOT included here by
 * default — the kernel registers them on demand.
 */
export const builtinTools: ReadonlyArray<{
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}> = [
  { definition: webSearchTool, handler: webSearchHandler },
  { definition: httpGetTool, handler: httpGetHandler },
  { definition: fileReadTool, handler: fileReadHandler },
  { definition: fileWriteTool, handler: fileWriteHandler },
  { definition: codeExecuteTool, handler: codeExecuteHandler },
  { definition: scratchpadWriteTool, handler: makeScratchpadWriteHandler(scratchpadStoreRef) },
  { definition: scratchpadReadTool, handler: makeScratchpadReadHandler(scratchpadStoreRef) },
];

/**
 * Meta-tool definitions (no default handlers — must be wired with live state).
 * Exported for schema inspection, documentation, and dynamic registration.
 */
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  taskCompleteTool,
];
