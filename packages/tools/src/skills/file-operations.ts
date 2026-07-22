import { Effect } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

// ─── File-root sandbox (AsyncLocalStorage) ──────────────────────────────────
// file-read / file-write resolve RELATIVE paths against — and confine them to —
// this root. Default (no root set) is `process.cwd()`, preserving prior
// behaviour. Callers that run untrusted/ephemeral agents (the benchmark harness
// per-task temp dir; future sandboxed runs) wrap execution in `withFileRoot()`
// so model-invented writes land inside the sandbox instead of polluting the
// repo root. ALS is concurrency-safe and propagates through Effect fibers, so
// parallel agents each see their own root with no global-state races.
const fileRootStore = new AsyncLocalStorage<string>();

/** Run `fn` with file-read/file-write rooted at (and confined to) `root`. */
export function withFileRoot<T>(root: string, fn: () => T): T {
  return fileRootStore.run(path.resolve(root), fn);
}

/** The active file root for relative-path resolution + traversal confinement. */
export function getFileRoot(): string {
  return fileRootStore.getStore() ?? process.cwd();
}

export const fileReadTool: ToolDefinition = {
  name: "file-read",
  description:
    "Read a file and return its full text content as a string. " +
    "Use this to read existing files or to verify what was written. " +
    "Returns the raw text content on success. " +
    "Fails with an error if the file does not exist.",
  parameters: [
    {
      name: "path",
      type: "string",
      description:
        "Relative or absolute path to the file to read. " +
        "Examples: './output.txt', './data/report.md', './results/data.json'. " +
        "Must be within the current working directory.",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description:
        "Text encoding of the file. Default: 'utf-8'. Only change this for non-UTF-8 files.",
      required: false,
      default: "utf-8",
    },
  ],
  returnType: "string — the complete text content of the file",
  category: "file",
  riskLevel: "medium",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
  // Read-only — never produces a durable artifact (audit 01-F1 / C2).
  produces: "none",
  // Sprint 3.4 Scaffold 1 — file-read reads ONE file per call. When a task
  // mentions multiple files, the classifier should multiply minCalls.
  cardinality: "per-entity",
};

export const fileReadHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const filePath = args.path as string;
      const encoding = (args.encoding as BufferEncoding) ?? "utf-8";

      if (!filePath || typeof filePath !== "string") {
        throw new Error("path parameter must be a non-empty string");
      }

      // Security: resolve RELATIVE paths against the active file root (default
      // process.cwd(); the bench/sandbox sets a temp dir via withFileRoot) and
      // confine the result to it.
      const allowedBase = getFileRoot();
      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(allowedBase, filePath);
      const normalizedBase = path.normalize(allowedBase);
      const normalizedResolved = path.normalize(resolved);

      if (!normalizedResolved.startsWith(normalizedBase)) {
        throw new Error(
          `Path traversal detected: ${filePath} resolves to ${resolved} outside of ${allowedBase}`,
        );
      }

      // A missing file is not a transient fault. Retrying ENOENT only burned
      // 300ms of backoff before returning the same answer; retry the faults
      // that can actually change (EBUSY / EAGAIN / EMFILE on a busy fs).
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await fs.readFile(resolved, { encoding });
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (!isTransientFsError(lastError) || attempt === 3) break;
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }
      }

      throw lastError;
    },
    catch: (e) =>
      new ToolExecutionError({
        // `${e}` on an Error yields "Error: ENOENT: ..." — a second "Error:"
        // prefix once wrapped, and a bare errno with no way to act on it.
        // Name the root, because a relative path the model invented is
        // meaningless without knowing what it resolved against.
        message: `File read failed: ${e instanceof Error ? e.message : String(e)} (working root: ${getFileRoot()})`,
        toolName: "file-read",
        cause: e,
      }),
  });

const TRANSIENT_FS_CODES = new Set(["EBUSY", "EAGAIN", "EMFILE", "ENFILE"]);

/** ENOENT/EACCES will not change between attempts; contention errors might. */
function isTransientFsError(e: Error): boolean {
  const code = (e as NodeJS.ErrnoException).code;
  return typeof code === "string" && TRANSIENT_FS_CODES.has(code);
}

export const listDirectoryTool: ToolDefinition = {
  name: "list-directory",
  description:
    "List the files and subdirectories at a path. " +
    "Use this BEFORE guessing a path, and immediately after any file-read fails — " +
    "it shows you what actually exists instead of making you guess again. " +
    "Returns { root, path, entries: [{ name, type, bytes }] }.",
  parameters: [
    {
      name: "path",
      type: "string",
      description:
        "Directory to list, relative to the working root. Default: '.' (the root itself). " +
        "Examples: '.', './data', './src/config'.",
      required: false,
      default: ".",
    },
  ],
  returnType: "{ root: string, path: string, entries: { name: string, type: 'file'|'dir', bytes?: number }[] }",
  category: "file",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
  produces: "none",
};

export const listDirectoryHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const requested = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";

      const allowedBase = getFileRoot();
      const resolved = path.isAbsolute(requested)
        ? path.resolve(requested)
        : path.resolve(allowedBase, requested);
      if (!path.normalize(resolved).startsWith(path.normalize(allowedBase))) {
        throw new Error(
          `Path traversal detected: ${requested} resolves outside of ${allowedBase}`,
        );
      }

      const dirents = await fs.readdir(resolved, { withFileTypes: true });
      const entries = await Promise.all(
        dirents.map(async (d) => {
          const type = d.isDirectory() ? "dir" : "file";
          if (type === "dir") return { name: d.name, type };
          const stat = await fs.stat(path.join(resolved, d.name)).catch(() => undefined);
          return stat ? { name: d.name, type, bytes: stat.size } : { name: d.name, type };
        }),
      );
      // Codepoint order, not localeCompare — the listing a model sees must not
      // depend on the host's locale.
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { root: allowedBase, path: resolved, entries };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `List directory failed: ${e instanceof Error ? e.message : String(e)}`,
        toolName: "list-directory",
        cause: e,
      }),
  });

export const fileWriteTool: ToolDefinition = {
  name: "file-write",
  description:
    "Write text to a file, creating parent directories as needed (overwrites any existing content). " +
    "Returns { written: true, path: '...' } on success — once you see this, the file is saved. " +
    "IMPORTANT: the required parameters are 'path' and 'content' — do NOT use 'file', 'filename', or 'filepath'.",
  parameters: [
    {
      name: "path",
      type: "string",
      description:
        "REQUIRED. Relative or absolute path where the file will be written. " +
        "Use 'path', NOT 'file' or 'filename'. " +
        "Examples: './output.txt', './results/report.md', './data.json'. " +
        "If no path is specified in the task, use a sensible default like './output.txt'. " +
        "Must be within the current working directory.",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description:
        "REQUIRED. The complete text to write to the file. This OVERWRITES any existing content — there is no append mode. " +
        "Use newlines (\\n) for multi-line content.",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description:
        "Text encoding. Default: 'utf-8'. Only change for non-UTF-8 content.",
      required: false,
      default: "utf-8",
    },
  ],
  returnType: "{ written: true, path: string } — confirms the file was saved successfully",
  category: "file",
  riskLevel: "high",
  timeoutMs: 5_000,
  requiresApproval: true,
  source: "builtin",
  // Produces a file artifact — path extracted from the path arg (audit 01-F1 / C2).
  produces: "file",
};

// Structured-data extensions whose files can NEVER legitimately begin with a
// markdown code fence. Models routinely wrap a JSON/CSV/YAML answer in
// ```json … ``` (or add a "Here is the file:" preamble) — writing that verbatim
// produces a `.json` deliverable that fails to parse (probe rw-1, 2026-07-22:
// `databases.json` → "Unrecognized token '`'"). This is a real production
// defect: a user who asked for `data.json` gets an unparseable file.
const STRUCTURED_EXT = new Set([
  ".json", ".jsonl", ".ndjson", ".geojson",
  ".csv", ".tsv", ".xml", ".yaml", ".yml", ".toml",
]);
const JSON_EXT = new Set([".json", ".jsonl", ".ndjson", ".geojson"]);
const LONE_FENCE_RE = /^```[\w+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
const ANY_FENCE_RE = /```[\w+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/;

/**
 * Correct the near-universal LLM habit of fencing a structured-data answer
 * before it becomes a durable, downstream-parsed artifact — a write-boundary
 * net so every strategy/path that writes a file inherits it.
 *
 * Narrow + safe by construction:
 *   - only structured-data extensions (a `.md`/`.txt` file legitimately holds
 *     fences, so those are never touched);
 *   - Case 1: the WHOLE content is one fenced block → unwrap it (a lone leading
 *     fence is never valid in a structured file, so this can't corrupt);
 *   - Case 2 (JSON only): content has preamble but contains a fenced block that
 *     actually `JSON.parse`s → extract it (guarded by the parse, so we never
 *     swap in something worse than what the model wrote).
 */
export function normalizeStructuredFileContent(filePath: string, content: string): string {
  if (typeof content !== "string") return content;
  const ext = path.extname(filePath).toLowerCase();
  if (!STRUCTURED_EXT.has(ext)) return content;

  const lone = LONE_FENCE_RE.exec(content.trim());
  if (lone) return lone[1] ?? content;

  if (JSON_EXT.has(ext)) {
    const block = ANY_FENCE_RE.exec(content);
    if (block?.[1]) {
      try {
        JSON.parse(block[1]);
        return block[1];
      } catch {
        // Fenced block isn't valid JSON either — leave the model's content as
        // written rather than guess.
      }
    }
  }
  return content;
}

export const fileWriteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const filePath = args.path as string;
      const content = normalizeStructuredFileContent(filePath, args.content as string);
      const encoding = (args.encoding as BufferEncoding) ?? "utf-8";

      // Guard: model passed a stored-result key instead of the actual content.
      if (/^_tool_result_\d+$/.test(content?.trim?.())) {
        throw new Error(
          `"${content}" is a storage key, not a value. ` +
          `Use recall("${content}") first, then pass the returned text as the content argument.`,
        );
      }

      // Resolve RELATIVE paths against the active file root (default cwd; the
      // bench/sandbox sets a temp dir via withFileRoot) and confine writes to
      // it — so a model-invented "report.md" lands in the sandbox, not the cwd.
      const allowedBase = getFileRoot();
      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(allowedBase, filePath);
      if (!path.normalize(resolved).startsWith(path.normalize(allowedBase))) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      const parent = path.dirname(resolved);
      await fs.mkdir(parent, { recursive: true });

      await fs.writeFile(resolved, content, { encoding });
      return { written: true, path: resolved };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `File write failed: ${e}`,
        toolName: "file-write",
        cause: e,
      }),
  });
