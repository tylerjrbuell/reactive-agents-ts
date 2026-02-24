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

// Shared scratchpad store — one per tool service instance (reset per agent run)
const scratchpadStoreRef = Ref.unsafeMake(new Map<string, string>());

/**
 * All built-in tools paired with their handlers.
 * Registered automatically when ToolServiceLive is created.
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
