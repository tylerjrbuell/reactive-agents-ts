import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const codeExecuteTool: ToolDefinition = {
  name: "code-execute",
  description:
    "Execute JavaScript/TypeScript code in an isolated Bun subprocess and return the result. " +
    "Best for: math, string transforms, JSON parsing, sorting, regex extraction, data processing. " +
    "IMPORTANT: The code runs in a separate process with NO access to stored results, tool outputs, " +
    "or agent state — variables like _tool_result_N do NOT exist in the code environment. " +
    "To process stored data, first retrieve it with recall(key, full: true), then inline the text in code. " +
    "ENVIRONMENT: require() for built-in Node.js modules is available (e.g. require('os'), require('path')). " +
    "Dynamic import() is also supported. No browser APIs (DOMParser, fetch). " +
    "For HTML text already retrieved: use regex or string methods — NOT DOMParser. " +
    "Example: const text = htmlString.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim(); " +
    "Use return <value> to return a result, or console.log() to produce output. " +
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
 * Writes the user code to a temp `.ts` file wrapped in an async IIFE so that
 * `return` statements work and `require()` is available via `createRequire`.
 * The wrapper always emits a final JSON line `{ ok, result, error }` on stdout;
 * any lines before that are user-produced console.log output.
 *
 * This avoids two `bun --eval` limitations:
 *   1. `eval()` does not allow `return` in ESM strict mode.
 *   2. `require` is not defined in an ESM `--eval` context.
 */
export const codeExecuteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const rawCode = args.code as string;
      const timeoutMs = 30_000;

      // Guard: model passed a stored-result key as the code to execute.
      if (/^_tool_result_\d+$/.test(rawCode?.trim?.())) {
        return {
          executed: false,
          error:
            `"${rawCode}" is a storage key, not code. ` +
            `Use recall("${rawCode}") first, then write code that processes the returned text.`,
        };
      }

      // Wrap user code in an async IIFE so `return` works, and inject
      // `createRequire` so CJS `require()` calls succeed in ESM context.
      // The wrapper always prints a JSON sentinel as the last stdout line.
      const wrapped = `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const __fn = async () => { ${rawCode} };
__fn()
  .then((r) => console.log(JSON.stringify({ ok: true, result: r ?? null })))
  .catch((e) => console.log(JSON.stringify({ ok: false, error: String(e) })));
`;

      const tmpFile = join(tmpdir(), `code-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
      try {
        writeFileSync(tmpFile, wrapped);
      } catch (e) {
        return {
          executed: false,
          error: `Failed to write temp file: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn(["bun", "run", tmpFile], {
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
      } catch (e) {
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
        return {
          executed: false,
          error: `Failed to spawn subprocess: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        try { proc.kill(); } catch { /* Process may already be gone */ }
      }, timeoutMs);

      // Read stdout and stderr
      const stdoutText = await new Response(proc.stdout).text();
      const stderrText = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);
      try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }

      const errorOutput = stderrText.trim();

      if (exitCode !== 0) {
        // Strip Bun's file path from the error output to avoid leaking temp paths
        const cleanError = errorOutput.replace(/\S*code-exec-[^\s]*/g, "<code>");
        return {
          executed: false,
          error: cleanError || `Process exited with code ${exitCode}`,
          output: "(no output)",
          exitCode,
        };
      }

      // The wrapper always emits a JSON sentinel as the last line of stdout.
      // Any lines before it are user console.log output.
      const lines = stdoutText.trimEnd().split("\n");
      const sentinelLine = lines[lines.length - 1] ?? "";
      const userOutputLines = lines.slice(0, -1);
      const output = userOutputLines.join("\n").trim();

      let sentinel: { ok: boolean; result?: unknown; error?: string };
      try {
        sentinel = JSON.parse(sentinelLine) as typeof sentinel;
      } catch {
        // Shouldn't happen unless the process was killed mid-write
        return {
          executed: false,
          error: `Unexpected output format (missing sentinel). stderr: ${errorOutput || "(none)"}`,
          output: output || "(no output)",
          exitCode,
        };
      }

      if (!sentinel.ok) {
        return {
          executed: false,
          error: sentinel.error ?? "Unknown runtime error",
          output: output || "(no output)",
          exitCode,
        };
      }

      return {
        executed: true,
        result: sentinel.result ?? null,
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
