import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const codeExecuteTool: ToolDefinition = {
  name: "code-execute",
  description:
    "Execute JavaScript code in an isolated subprocess and return the result. " +
    "Best for: math calculations, string transformations, sorting, parsing, and data processing. " +
    "The code runs in a separate process with no access to the agent's memory or state. " +
    "Use console.log() to produce output. The last expression is NOT auto-returned. " +
    "Returns { executed: true, result, output, exitCode } on success.",
  parameters: [
    {
      name: "code",
      type: "string",
      description:
        "JavaScript code to execute in a subprocess. " +
        "Use console.log() to produce output. " +
        "Examples: 'console.log(2 + 2)' → output: '4', " +
        "'console.log(JSON.stringify([3,1,2].sort()))' → output: '[1,2,3]'.",
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
    "{ executed: true, result: any, output: string, exitCode: number } on success; { executed: false, error: string } on failure",
  category: "code",
  riskLevel: "critical",
  timeoutMs: 30_000,
  requiresApproval: true,
  source: "builtin",
};

/**
 * Execute code in an isolated Bun subprocess.
 *
 * Uses `Bun.spawn(["bun", "--eval", code])` — the code runs in a separate
 * process with no access to the agent's memory, services, or state.
 * Stdout/stderr are captured; a timeout kills the process if exceeded.
 */
export const codeExecuteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const code = args.code as string;
      const timeoutMs = 30_000;

      const proc = Bun.spawn(["bun", "--eval", code], {
        stdout: "pipe",
        stderr: "pipe",
        // Run in /tmp to prevent Bun from auto-loading .env files from the project.
        cwd: "/tmp",
        // Minimal env: only PATH for executable resolution, HOME for bun internals.
        // No API keys, secrets, or application env vars are passed.
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "/tmp",
        },
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Process may already be gone
        }
      }, timeoutMs);

      // Read stdout and stderr
      const stdoutText = await new Response(proc.stdout).text();
      const stderrText = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);

      const output = stdoutText.trim();
      const errorOutput = stderrText.trim();

      if (exitCode !== 0) {
        return {
          executed: false,
          error: errorOutput || `Process exited with code ${exitCode}`,
          output: output || "(no output)",
          exitCode,
        };
      }

      // Try to parse the output as JSON for structured results
      let result: unknown = output;
      try {
        result = JSON.parse(output);
      } catch {
        // Keep as string
      }

      return {
        executed: true,
        result: result ?? null,
        output: output || "(no output)",
        exitCode,
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Code execution failed: ${e instanceof Error ? e.message : String(e)}`,
        toolName: "code-execute",
        cause: e,
      }),
  });
