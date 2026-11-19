import { accessSync, constants as fsConstants, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { Effect } from "effect";
import { errorMessage } from "@reactive-agents/core";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { makeDockerSandbox, runSandboxEffect } from "../execution/docker-sandbox.js";
import { sandboxDockerEnabled } from "../flags.js";
import { HANDLER_TIMEOUT_GRACE_MS } from "./timeout-grace.js";
import { runProcessGroup } from "./process-group.js";

/** A single-line static import (`import x from "m"`, `import "m"`, `import type {T} from "m"`). */
const IMPORT_LINE_RE = /^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"][^'"\n]+['"]\s*;?\s*$/;
/** `export` in front of a declaration; the wrapper is a function body, where `export` is a syntax error. */
const EXPORT_DECL_RE = /^(\s*)export\s+(?:default\s+)?(?=(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\b)/;

/**
 * Models write module-style code (`import x from "m"`, `export function f`).
 * Inside the async-function wrapper both are syntax errors (witness: granite
 * rw-7, "Unexpected export", 2026-11-13). Hoist single-line imports above the
 * wrapper and drop `export` from declarations; everything else is unchanged.
 */
export function hoistModuleSyntax(rawCode: string): { readonly imports: string; readonly body: string } {
  const imports: string[] = [];
  const body: string[] = [];
  for (const line of rawCode.split("\n")) {
    if (IMPORT_LINE_RE.test(line)) imports.push(line.trim());
    else body.push(line.replace(EXPORT_DECL_RE, "$1"));
  }
  return { imports: imports.join("\n"), body: body.join("\n") };
}

/** Wrap user code so `return` works and CJS `require()` is available in ESM. */
function wrapCode(rawCode: string): string {
  const { imports, body } = hoistModuleSyntax(rawCode);
  return `
import { createRequire } from "node:module";
${imports}
const require = createRequire(import.meta.url);
const __fn = async () => { ${body} };
__fn()
  .then((r) => console.log(JSON.stringify({ ok: true, result: r ?? null })))
  .catch((e) => console.log(JSON.stringify({ ok: false, error: String(e) })));
`;
}

/** `language` labels that run as JavaScript/TypeScript under Bun. */
const JS_TS_LANGUAGES: ReadonlySet<string> = new Set(["javascript", "typescript", "js", "ts"]);
/** `language` labels that run as Python 3 under the host `python3`. */
const PYTHON_LANGUAGES: ReadonlySet<string> = new Set(["python", "python3", "py"]);

/** Language a code-execute call runs in. */
type CodeLanguage = "js" | "python";

/** Resolve the `language` arg; `undefined` for an unsupported label. Empty means JavaScript. */
const resolveLanguage = (raw: unknown): CodeLanguage | undefined => {
  const label = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (label === "" || JS_TS_LANGUAGES.has(label)) return "js";
  return PYTHON_LANGUAGES.has(label) ? "python" : undefined;
};

/** Python traceback lines kept on failure: the cause is at the end. */
const PYTHON_ERROR_TAIL_LINES = 20;

/** Python parse failures; the code never ran. */
const PYTHON_SYNTAX_ERROR_RE = /^\s*(?:SyntaxError|IndentationError|TabError)\b/m;

/** First `python3` executable on `pathEnv`, or `undefined` when the host has none. */
function findPython3(pathEnv: string): string | undefined {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "python3");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* not in this directory */
    }
  }
  return undefined;
}

/** Bun's trailing version banner adds nothing the model can act on. */
const BUN_BANNER_RE = /\n*Bun v\d[^\n]*\s*$/;
/** ENOENT on a relative path: code-execute's cwd is /tmp, not the workspace. */
const ENOENT_HINT =
  " Hint: the working directory is /tmp, not the workspace, so relative paths do not resolve. " +
  "Use the absolute path from the task (host sandbox only), or inline the data in the code.";

/** Bun parse failures (`error: Expected ";" but found ":"`) and thrown SyntaxError text. */
const SYNTAX_ERROR_RE =
  /SyntaxError|^\s*error: (?:Expected|Unexpected|Unterminated|Invalid|Missing|Unclosed)\b/m;

/**
 * Appended to failures where the code never ran (wrong language, shell input,
 * syntax error). The tool contract must be recoverable from its own error:
 * accepted language, one runnable example, and where data has to come from.
 */
export const CODE_RETRY_GUIDE =
  " Retry with JavaScript/TypeScript, for example: " +
  "`const xs = [3, 5, 9]; return xs.reduce((a, b) => a + b, 0) / xs.length;`. " +
  "Data must be inlined in the code: each call starts clean in /tmp and keeps no variables. " +
  "To use a file's data, read it with the file-read tool first, then paste the numbers into the code.";

/** Retry guide for a never-executed Python failure (language: 'python'). */
export const PYTHON_RETRY_GUIDE =
  " Retry with Python 3, for example: " +
  "`xs = [3, 5, 9]; print(sum(xs) / len(xs))`. " +
  "Print the answer: stdout arrives in `result`. " +
  "Data must be inlined in the code: each call starts clean in /tmp and keeps no variables. " +
  "To use a file's data, read it with the file-read tool first, then paste the numbers into the code.";

/** Retry guide matching the language the model used. */
const retryGuideFor = (language: CodeLanguage): string =>
  language === "python" ? PYTHON_RETRY_GUIDE : CODE_RETRY_GUIDE;

/** Add the retry guide when the failure is a never-executed syntax error. */
const withSyntaxGuide = (message: string): string =>
  SYNTAX_ERROR_RE.test(message)
    ? `${message}\nThe code is not valid JavaScript/TypeScript (Python syntax, pasted data or stray text cause this). ` +
      `For Python code set language to "python".${CODE_RETRY_GUIDE}`
    : message;

/** Keep the last lines of a Python traceback and scrub the temp-file path. */
function explainPythonError(raw: string, fallback: string): string {
  const cleaned = raw.replace(/\S*code-exec-[^\s]*/g, "<code>").trim();
  const tail = cleaned.split("\n").slice(-PYTHON_ERROR_TAIL_LINES).join("\n");
  const message = tail.length > 0 ? tail : fallback;
  const withHint = /FileNotFoundError|No such file or directory/i.test(message) ? message + ENOENT_HINT : message;
  return PYTHON_SYNTAX_ERROR_RE.test(withHint)
    ? `${withHint}\nThe code is not valid Python 3.${PYTHON_RETRY_GUIDE}`
    : withHint;
}

/** Result for a finished Python run: stdout is the answer, there is no `return`. */
function parsePythonResult(stdout: string, stderr: string, exitCode: number): unknown {
  const out = stdout.trim();
  if (exitCode !== 0) {
    return {
      executed: false,
      error: explainPythonError(stderr, `Process exited with code ${exitCode} and wrote nothing to stderr.`),
      output: out || "(no output)",
      exitCode,
    };
  }
  return { executed: true, result: out === "" ? null : out, output: out || "(no output)", exitCode };
}

/**
 * Make a failure message non-empty and model-actionable: strip the temp-file
 * path and Bun banner, name the cause when the text is empty, and explain the
 * /tmp working directory on a missing file.
 */
export function explainCodeError(raw: string, fallback: string): string {
  const cleaned = raw.replace(/\S*code-exec-[^\s]*/g, "<code>").replace(BUN_BANNER_RE, "").trim();
  const message = cleaned.length > 0 ? cleaned : fallback;
  return withSyntaxGuide(/ENOENT|no such file or directory/i.test(message) ? message + ENOENT_HINT : message);
}

/** Parse the wrapper's stdout sentinel into the code-execute result shape. */
function parseCodeResult(stdout: string, stderr: string, exitCode: number): unknown {
  const errorOutput = stderr.trim();
  if (exitCode !== 0) {
    return {
      executed: false,
      error: explainCodeError(errorOutput, `Process exited with code ${exitCode} and wrote nothing to stderr.`),
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
      error:
        `Unexpected output format (missing sentinel): the code finished with exit code ${exitCode} but the result line was not printed. ` +
        `stderr: ${errorOutput || "(none)"}. ` +
        "Hint: likely cause is process.exit(), or code that overwrote console.log/stdout. " +
        "Do not call process.exit(); end the code with `return <value>`.",
      output: output || "(no output)",
      exitCode,
    };
  }
  if (!sentinel.ok) {
    return {
      executed: false,
      error: explainCodeError(
        sentinel.error ?? "",
        "The code threw a value with no message (for example `throw \"\"`). Throw an Error with a message to see the cause.",
      ),
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
const shellInputRefusal = (code: string, language: CodeLanguage = "js"): string => {
  const first = code.trim().split("\n")[0] ?? "";
  const shown = first.length > 80 ? `${first.slice(0, 80)}…` : first;
  return (
    `${JSON.stringify(shown)} is a shell command, not ${language === "python" ? "Python" : "JavaScript/TypeScript"}. ` +
    `code-execute runs JavaScript/TypeScript (Bun) or Python 3 source code; it does not run shell commands ` +
    `(a line like \`python3 script.py\` is a shell command: write the Python source itself). ` +
    `Nothing was executed.${retryGuideFor(language)}`
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
    "ENVIRONMENT: runs as a Bun subprocess (JavaScript/TypeScript) or a host python3 subprocess (Python) on the host machine. " +
    "It is NOT isolated: it runs as the same OS user " +
    "and can read host files. Environment variables are cleared except PATH and HOME. " +
    "The working directory is /tmp, not the agent's working root: relative paths in fs calls resolve under /tmp. " +
    "To read or write workspace files, use the file tools instead. " +
    "fetch() is available, with the host's network access. " +
    "require() for built-in Node.js modules and dynamic import() work. Bun accepts TypeScript syntax, including type annotations. " +
    "No DOM APIs (DOMParser, document). ",
  docker:
    "ENVIRONMENT: runs (JavaScript/TypeScript with Bun, or Python 3) in an isolated, throwaway Docker container with no network access " +
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
    "Execute JavaScript/TypeScript (Bun, the default) or Python 3 (set language: 'python'). No shell commands: other languages fail. " +
    "STATELESS: each call is a fresh process in /tmp; no variables or files carry over, so inline all data in the code " +
    "(or read a file by absolute path on the host sandbox; otherwise read it with the file tools first, then paste the values). " +
    "Best for: math, aggregation, string transforms, JSON parsing, sorting, regex extraction. " +
    "Example: const rows = [3, 5, 9]; return rows.reduce((a, b) => a + b, 0) / rows.length; " +
    "IMPORTANT: The code runs in a separate process with NO access to stored results, tool outputs, " +
    "or agent state — variables like _tool_result_N do NOT exist in the code environment. " +
    storedDataText(config) +
    ENVIRONMENT_TEXT[sandbox] +
    "For HTML text: use regex or string methods, NOT DOMParser. " +
    "RESULT CONTRACT (JavaScript/TypeScript): you MUST end with `return <value>` — the returned value arrives in the `result` field. " +
    "A bare final expression (no return) yields result:null; console.log() text arrives ONLY in the `output` string. " +
    "RESULT CONTRACT (Python): there is no `return`; print() the answer: its stdout arrives in `result` (and `output`). " +
    "Returns { executed: true, result, output, exitCode } on success.",
  parameters: [
    {
      name: "code",
      type: "string",
      description:
        "JavaScript (default) or Python source to execute in a subprocess. " +
        "JavaScript: end with `return <value>` — that value becomes the `result` field (a bare expression yields result:null). " +
        "Python: print() the answer; stdout becomes the `result` field. " +
        "Examples: 'return 2 + 2' → result: 4, " +
        "'return [3,1,2].sort()' → result: [1,2,3]; " +
        "(language python) 'print(sum([3,1,2]))' → result: \"6\".",
      required: true,
    },
    {
      name: "language",
      type: "string",
      description:
        "Optional label: 'javascript' (default), 'typescript' (both run under Bun) or 'python' (Python 3, host python3). " +
        "Other languages are rejected.",
      required: false,
      default: "javascript",
    },
  ],
  returnType:
    "{ executed: true, result: any, output: string, exitCode: number } on success; { executed: false, error: string } on failure",
  category: "code",
  riskLevel: "critical",
  // Handler kills at the resolved timeout; the outer ToolService race runs just after it.
  timeoutMs: resolveCodeTimeout(config) + HANDLER_TIMEOUT_GRACE_MS,
  requiresApproval: true,
  mutatesExternalState: true,
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

      // Guard: non-JS language label (was an opaque enum rejection upstream).
      const language = resolveLanguage(args.language);
      if (language === undefined) {
        return {
          executed: false,
          error:
            `language "${String(args.language)}" is not supported: code-execute runs JavaScript/TypeScript (Bun) ` +
            `or Python 3 only (no shell). Nothing was executed.${CODE_RETRY_GUIDE}`,
        };
      }

      // Guard: shell input. Run as code it fails with a syntax or reference
      // error, which reads as "fix the code". `shellCommand: true` lets the
      // caller name a shell tool when one is offered.
      if (typeof rawCode === "string" && isShellInput(rawCode)) {
        return { executed: false, shellCommand: true, error: shellInputRefusal(rawCode, language) };
      }

      // JavaScript: wrap user code in an async IIFE so `return` works, and inject
      // `createRequire` so CJS `require()` calls succeed in ESM context.
      // The wrapper always prints a JSON sentinel as the last stdout line.
      // Python: the source runs as written; stdout is the answer.
      const wrapped = language === "python" ? rawCode : wrapCode(rawCode);
      const parse = language === "python" ? parsePythonResult : parseCodeResult;

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
          dockerSandbox.execute(wrapped, language === "python" ? "python" : "bun").pipe(
            Effect.catchAll((err) =>
              Effect.succeed({
                output: "",
                stderr:
                  `Docker sandbox failed: ${err.message || "no reason given"}. ` +
                  `Nothing was executed. The sandbox is set to docker; check that Docker is installed and running.`,
                exitCode: 1,
                durationMs: 0,
                truncated: false,
                image: "unavailable",
              }),
            ),
          ),
        );
        return parse(dockerResult.output, dockerResult.stderr, dockerResult.exitCode);
      }

      const hostPath = process.env.PATH ?? "/usr/bin:/bin";
      let python3: string | undefined;
      if (language === "python") {
        python3 = findPython3(hostPath);
        if (python3 === undefined) {
          return {
            executed: false,
            error:
              "python3 not found on the host (not on PATH). Nothing was executed. " +
              "Retry with JavaScript/TypeScript (language: 'javascript'), which does not need python3.",
          };
        }
      }

      const ext = language === "python" ? "py" : "ts";
      const tmpFile = join(tmpdir(), `code-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
      try {
        writeFileSync(tmpFile, wrapped);
      } catch (e) {
        return {
          executed: false,
          error: `Failed to write temp file: ${errorMessage(e)}`,
        };
      }

      // The code runs in its own process group; the timeout kills the group,
      // so a child it spawned cannot hold stdout open past the kill.
      const run = await runProcessGroup({
        // Python: -B no .pyc files, -s no user site-packages, -u unbuffered stdout
        // (output printed before a timeout kill is kept).
        argv: python3 !== undefined ? [python3, "-B", "-s", "-u", tmpFile] : ["bun", "run", tmpFile],
        // Run in /tmp to prevent Bun from auto-loading .env files from the project.
        cwd: "/tmp",
        // Minimal env: only PATH for executable resolution, HOME for bun internals.
        // No API keys, secrets, or application env vars are passed.
        env: {
          PATH: hostPath,
          HOME: process.env.HOME ?? "/tmp",
          ...(language === "python" ? { PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1", PYTHONUNBUFFERED: "1" } : {}),
        },
        timeoutMs,
      }).finally(() => {
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
      });

      if (run.timedOut) return timedOutCodeResult(run.stdout, run.exitCode, timeoutMs);
      return parse(run.stdout, run.stderr, run.exitCode);
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Code execution failed: ${errorMessage(e)}`,
        toolName: "code-execute",
        cause: e,
      }),
  });
};
