import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const codeExecuteTool: ToolDefinition = {
  name: "code-execute",
  description: "Execute a JavaScript/TypeScript code snippet in a sandboxed environment",
  parameters: [
    {
      name: "code",
      type: "string",
      description: "Code to execute",
      required: true,
    },
    {
      name: "language",
      type: "string",
      description: "Programming language",
      required: false,
      default: "javascript",
      enum: ["javascript", "typescript"],
    },
  ],
  category: "code",
  riskLevel: "critical",
  timeoutMs: 30_000,
  requiresApproval: true,
  source: "builtin",
};

export const codeExecuteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.try({
    try: () => {
      const code = args.code as string;
      // Phase 1: Simple eval-based execution (stub)
      // In production: use isolated-vm or Worker threads
      // For safety, we only return a stub response
      return {
        code,
        executed: false,
        message:
          "Code execution stub - production implementation requires sandboxed runtime",
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Code execution failed: ${e}`,
        toolName: "code-execute",
        cause: e,
      }),
  });
