import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { makeDockerSandbox, runSandboxEffect } from "../execution/docker-sandbox.js";
import { sandboxDockerEnabled } from "../flags.js";
import { HANDLER_TIMEOUT_GRACE_MS } from "./timeout-grace.js";
import { runProcessGroup } from "./process-group.js";

/** Wrap user code so `return` works and CJS `require()` is available in ESM. */
function wrapCode(rawCode: string): string {
  return `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const __fn = async () => { ${rawCode} };
__fn()
  .then((r) => console.log(JSON.stringify({ ok: true, result: r ?? null })))
  .catch((e) => console.log(JSON.stringify({ ok: false, error: String(e) })));
`;
}

/** Parse the wrapper's stdout sentinel into the code-execute result shape. */
function parseCodeResult(stdout: string, stderr: string, exitCode: number): unknown {
  const errorOutput = stderr.trim();
  if (exitCode !== 0) {
    const cleanError = errorOutput.replace(/\S*code-exec-[^\s]*/g, "<code>");
    return {
      executed: false,
      error: cleanError || `Process exited with code ${exitCode}`,
      output: "(no output)",
      exitCode,
    };
  }
  const lines = stdout.trimEnd().split("\n");
  const sentinelLine = lines[lines.length - 1] ?? "";
  const output = lines.slice(0, -1).join("\n").trim();

  let sentinel: { ok: boolean; result?: unknown; error?: string };
  try {
    sentinel = JSON.parse(sentinelLine) as typeof sentinel;
  } catch {
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
}

/**
 * Result for code killed at its timeout. The code never returned, so there is
 * no `result`; console output printed before the kill is kept in `output`.
 */
function timedOutCodeResult(stdout: string, exitCode: number, timeoutMs: number): unknown {
  return {
    executed: false,
    timedOut: true,
    error: `Code timed out after ${timeoutMs}ms and was killed. Output is partial; there is no return value. The exit code reflects the kill.`,
    output: stdout.trim() || "(no output)",
    exitCode,
  };
}

/**
 * Per-call override for {@link codeExecuteHandler}'s sandbox choice.
 * Precedence: `config.sandbox` > `RA_SANDBOX` env > `"host"` default —
 * matches `ShellExecuteConfig.sandbox` in `shell-execution.ts`, the sibling
 * tool this factory shape was copied from to close a real inconsistency
 * (this handler used to read `sandboxDockerEnabled()` directly with no way
 * to override it per call, while shell-execute already accepted `config.sandbox`).
 */
export interface CodeExecuteConfig {
  readonly sandbox?: "docker" | "host";
  /** Kill the code after this many milliseconds. Default {@link DEFAULT_CODE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /**
   * `recall` is registered for the run. Only then do the description and the
   * storage-key refusal tell the model to call it; otherwise they say to
   * inline the text (truthfulness audit 2026-11-06, finding #3: recall is
   * often gated off the wire).
   */
  readonly recall?: boolean;
}

/** Default code-execute kill timeout. */
export const DEFAULT_CODE_TIMEOUT_MS = 30_000;

const resolveCodeTimeout = (config?: CodeExecuteConfig): number =>
  config?.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;

/** How the model gets stored data into code, for the given config. */
const storedDataText = (config?: CodeExecuteConfig): string =>
  config?.recall
    ? "To process stored data, first retrieve it with recall(key, full: true), then inline the text in code. "
    : "To process stored data, inline the text you need in the code as a string literal. ";

/** Refusal for a stored-result key passed as `code`. */
const storageKeyRefusal = (key: string, config?: CodeExecuteConfig): string =>
  config?.recall
    ? `"${key}" is a storage key, not code. Use recall("${key}") first, then write code that processes the returned text.`
    : `"${key}" is a storage key, not code. Code cannot read stored results: inline the text you need in the code as a string literal.`;

/**
 * Programs a shell line starts with. Only these count, so a JS identifier
 * that happens to be a word (`cat.name`, `find(x)`) is never mistaken.
 */
const SHELL_PROGRAMS =
  "bun|bunx|npm|npx|yarn|pnpm|node|deno|tsc|git|ls|cd|cat|grep|rg|find|mkdir|rm|cp|mv|touch|chmod|pwd|echo|" +
  "curl|wget|python|python3|pip|pip3|make|docker|head|tail|wc|sed|awk|which";
/** One shell line: program, then bare words, flags, paths, quoted words, `&&`/`|`/`>` joins. */
const SHELL_LINE_RE = new RegExp(
  `^(?:\\$\\s+)?(?:${SHELL_PROGRAMS})(?:\\s+(?:&&|\\|\\||\\||>>?|2>&1|[-\\w./@:~*$%+,]+(?:=[-\\w./@:~*$%+,"']*)?|"[^"\\n]*"|'[^'\\n]*'))*\\s*$`,
);

/**
 * True when `code` is shell input, not JavaScript: every non-empty line is a
 * shell command line (`bun test`, `npm run build`, `ls -la`, `cd src && ls`).
 * Live witness (leverage scan 2026-11-07, item 4): 9 of 9 code-execute calls
 * in rw-7 + lh-debug-green were shell commands, and the reply said to fix
 * the code.
 */
export function isShellInput(code: string): boolean {
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => SHELL_LINE_RE.test(l));
}

/**
 * Refusal for shell input. States what code-execute is and that shell input
 * does not run here; it never names a shell tool, because whether one is
 * offered this run is known to the caller (`exposedToolNames`), not here.
 */
const shellInputRefusal = (code: string): string => {
  const first = code.trim().split("\n")[0] ?? "";
  const shown = first.length > 80 ? `${first.slice(0, 80)}…` : first;
  return (
    `${JSON.stringify(shown)} is a shell command, not JavaScript/TypeScript. ` +
    `code-execute runs JavaScript/TypeScript code with Bun; it does not run shell commands. Nothing was executed.`
  );
};

/**
 * The sandbox a code-execute call runs in. Single resolver shared by the
 * handler and {@link codeExecuteToolFor}, so the model-facing description is
 * rendered from the same decision the handler makes.
 */
const resolveCodeSandbox =(config?: CodeExecuteConfig): "docker" | "host" =>
  config?.sandbox ?? (sandboxDockerEnabled() ? "docker" : "host");

/**
 * Environment facts the model needs, per sandbox. Each host-mode claim is
 * measured against the real handler in
 * `tests/builtin-description-truth.test.ts`: `fetch` exists, TypeScript
 * annotations run, cwd is `/tmp`, and host files are readable (so the host
 * subprocess is NOT described as isolated).
 */
const ENVIRONMENT_TEXT: Record<"docker" | "host", string> = {
  host:
    "ENVIRONMENT: runs as a Bun subprocess on the host machine. It is NOT isolated: it runs as the same OS user " +
    "and can read host files. Environment variables are cleared except PATH and HOME. " +
    "The working directory is /tmp, not the agent's working root: relative paths in fs calls resolve under /tmp. " +
    "To read or write workspace files, use the file tools instead. " +
    "fetch() is available, with the host's network access. " +
    "require() for built-in Node.js modules and dynamic import() work. Bun accepts TypeScript syntax, including type annotations. " +
    "No DOM APIs (DOMParser, document). ",
  docker:
    "ENVIRONMENT: runs in an isolated, throwaway Docker container with no network access " +
    "(fetch() calls fail), a read-only filesystem except /tmp, and no access to host files. " +
    "require() for built-in Node.js modules and dynamic import() work. " +
    "No DOM APIs (DOMParser, document). ",
};

/**
 * Build the code-execute definition for a resolved sandbox. The description
 * states only what that sandbox does (same rule as `shellExecuteToolFor`).
 * Pass the same `config` the handler gets.
 */
export const codeExecuteToolFor = (config?: CodeExecuteConfig): ToolDefinition => {
  const sandbox = resolveCodeSandbox(config);
  return {
  name: "code-execute",
  description:
    "Execute JavaScript/TypeScript code with Bun and return the result. " +
    "Best for: math, string transforms, JSON parsing, sorting, regex extraction, data processing. " +
    "IMPORTANT: The code runs in a separate process with NO access to stored results, tool outputs, " +
    "or agent state — variables like _tool_result_N do NOT exist in the code environment. " +
    storedDataText(config) +
    ENVIRONMENT_TEXT[sandbox] +
    "For HTML text already retrieved: use regex or string methods — NOT DOMParser. " +
    "Example: const text = htmlString.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim(); " +
    "RESULT CONTRACT: you MUST end with `return <value>` — the returned value arrives in the `result` field. " +
    "A bare final expression (no return) yields result:null; console.log() text arrives ONLY in the `output` string. " +
    "Returns { executed: true, result, output, exitCode } on success.",
  parameters: [
    {
      name: "code",
      type: "string",
      description:
        "JavaScript code to execute in a subprocess. " +
        "End with `return <value>` — that value becomes the `result` field (a bare expression yields result:null). " +
        "Examples: 'return 2 + 2' → result: 4, " +
        "'return [3,1,2].sort()' → result: [1,2,3].",
      required: true,
    },
    {
      name: "language",
      type: "string",
      description:
        "Programming language label: 'javascript' (default) or 'typescript'. " +
        "Either value runs the same way: the code is executed by Bun.",
      required: false,
      default: "javascript",
      enum: ["javascript", "typescript"],
    },
  ],
  returnType:
    "{ executed: true, result: any, output: string, exitCode: number } on success; { executed: false, error: string } on failure",
  category: "code",
  riskLevel: "critical",
  // Handler kills at the resolved timeout; the outer ToolService race runs just after it.
  timeoutMs: resolveCodeTimeout(config) + HANDLER_TIMEOUT_GRACE_MS,
  requiresApproval: true,
  source: "builtin",
  // CAN write files via fs/Bun calls in the code — recognized as a file
  // producer so those writes become visible artifacts (audit 01-F1 / C2).
  produces: "file",
  };
};

/**
 * Default code-execute definition: sandbox resolved from `RA_SANDBOX` at
 * module load, the same resolution `codeExecuteHandler()` makes with no
 * config. Callers passing a `CodeExecuteConfig` to the handler should
 * register `codeExecuteToolFor(config)` alongside it.
 */
export const codeExecuteTool: ToolDefinition = codeExecuteToolFor();

/**
 * Execute code in a Bun subprocess (host) or a hardened container (docker).
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

/**
 * Create a code-execute handler with the given configuration.
 *
 * Returns a function `(args) => Effect<unknown, ToolExecutionError>`.
 * Calling with no config preserves the historical env-only behavior exactly.
 */
export const codeExecuteHandler = (
  config?: CodeExecuteConfig,
): ((args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>) => {
  // One sandbox per handler (not per call) so its stale-container reaper
  // runs once, not on every code-execute call.
  const timeoutMs = resolveCodeTimeout(config);
  const dockerSandbox = makeDockerSandbox({ timeoutMs });
  return (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const rawCode = args.code as string;

      // Guard: model passed a stored-result key as the code to execute.
      if (/^_tool_result_\d+$/.test(rawCode?.trim?.())) {
        return { executed: false, error: storageKeyRefusal(rawCode, config) };
      }

      // Guard: shell input. Run as JS it fails with a syntax or reference
      // error, which reads as "fix the code". `shellCommand: true` lets the
      // caller name a shell tool when one is offered.
      if (typeof rawCode === "string" && isShellInput(rawCode)) {
        return { executed: false, shellCommand: true, error: shellInputRefusal(rawCode) };
      }

      // Wrap user code in an async IIFE so `return` works, and inject
      // `createRequire` so CJS `require()` calls succeed in ESM context.
      // The wrapper always prints a JSON sentinel as the last stdout line.
      const wrapped = wrapCode(rawCode);

      // ── Opt-in Docker sandbox (F1b) ──
      // config.sandbox > RA_SANDBOX env > "host" default. Runs the code inside
      // a hardened throwaway container (no network, non-root, read-only
      // rootfs) instead of a host subprocess.
      const useDockerSandbox = resolveCodeSandbox(config) === "docker";
      if (useDockerSandbox) {
        // runSandboxEffect: a cancelled tool call interrupts the sandbox
        // effect, whose release step removes the container.
        const dockerResult = await runSandboxEffect(
          signal,
          dockerSandbox.execute(wrapped, "bun").pipe(
            Effect.catchAll((err) =>
              Effect.succeed({
                output: "",
                stderr: err.message,
                exitCode: 1,
                durationMs: 0,
                truncated: false,
                image: "unavailable",
              }),
            ),
          ),
        );
        return parseCodeResult(dockerResult.output, dockerResult.stderr, dockerResult.exitCode);
      }

      const tmpFile = join(tmpdir(), `code-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
      try {
        writeFileSync(tmpFile, wrapped);
      } catch (e) {
        return {
          executed: false,
          error: `Failed to write temp file: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // The code runs in its own process group; the timeout kills the group,
      // so a child it spawned cannot hold stdout open past the kill.
      const run = await runProcessGroup({
        argv: ["bun", "run", tmpFile],
        // Run in /tmp to prevent Bun from auto-loading .env files from the project.
        cwd: "/tmp",
        // Minimal env: only PATH for executable resolution, HOME for bun internals.
        // No API keys, secrets, or application env vars are passed.
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "/tmp",
        },
        timeoutMs,
      }).finally(() => {
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
      });

      if (run.timedOut) return timedOutCodeResult(run.stdout, run.exitCode, timeoutMs);
      return parseCodeResult(run.stdout, run.stderr, run.exitCode);
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Code execution failed: ${e instanceof Error ? e.message : String(e)}`,
        toolName: "code-execute",
        cause: e,
      }),
  });
};
