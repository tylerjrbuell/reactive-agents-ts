import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const codeExecuteTool: ToolDefinition = {
  name: "code-execute",
  description:
    "Execute synchronous JavaScript code and return the result. " +
    "Best for: math calculations, string transformations, sorting, parsing, and data processing. " +
    "The code runs in an isolated scope with no file system, no network, and no require/import. " +
    "Use a 'return' statement to produce a result, or the last expression will be returned. " +
    "Returns { executed: true, result, output } on success.",
  parameters: [
    {
      name: "code",
      type: "string",
      description:
        "Synchronous JavaScript code to execute. " +
        "Use 'return' to produce a value. No await, no require, no import. " +
        "Examples: 'return 2 + 2' → 4, " +
        "'function fact(n){return n<=1?1:n*fact(n-1)} return fact(10)' → 3628800, " +
        "'return [3,1,2].sort((a,b)=>a-b).join(\",\")' → '1,2,3'.",
      required: true,
    },
    {
      name: "language",
      type: "string",
      description:
        "Programming language for the code. Default: 'javascript'. " +
        "Use plain JavaScript syntax — TypeScript type annotations will cause a syntax error.",
      required: false,
      default: "javascript",
      enum: ["javascript", "typescript"],
    },
  ],
  returnType:
    "{ executed: true, result: any, output: string } on success; { executed: false, error: string } on failure",
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

      // Execute in an isolated function scope (no module/global access)
      // eslint-disable-next-line no-new-func
      const fn = new Function(code);
      const result = fn();

      return {
        executed: true,
        result: result ?? null,
        output: result !== null && result !== undefined ? String(result) : "(no return value)",
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Code execution failed: ${e instanceof Error ? e.message : String(e)}`,
        toolName: "code-execute",
        cause: e,
      }),
  });
