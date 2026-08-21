import { Effect } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError, toToolError } from "../errors.js";

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

// ─── Corrective traversal guard ─────────────────────────────────────────────
// Small local tool-callers routinely invent ABSOLUTE paths ("/home/user/
// logs.txt", "/app/logs.txt") for a file that exists right under the working
// root as "./logs.txt" (issue #201: granite4 burned 2-4 rejected calls per
// run this way, one rep needing 8 iterations to recover). The guard's job is
// unchanged — the call is still refused — but a bare rejection makes the
// model guess again from nothing. The error is corrective instead: it names
// the root, states the relative-path rule, and when a suffix of the rejected
// path actually exists under the root, names that path outright, so the next
// call can be the right one.

/** Longest suffix of `rejected`'s components that exists under `base`, as a
 * "./"-prefixed relative path — or undefined. Probes at most `maxProbes`
 * suffixes (deepest first, so "./data/logs.txt" beats "./logs.txt" when both
 * exist). */
async function existingSuffixUnder(
  base: string,
  rejected: string,
  maxProbes = 4,
): Promise<string | undefined> {
  const parts = rejected.split(/[\\/]+/).filter((p) => p.length > 0 && p !== "." && p !== "..");
  const deepest = Math.min(parts.length, maxProbes);
  for (let take = deepest; take >= 1; take--) {
    const candidate = parts.slice(parts.length - take).join("/");
    const probe = path.resolve(base, candidate);
    // The probe itself must stay confined — a candidate that escapes is no fix.
    if (!path.normalize(probe).startsWith(path.normalize(base))) continue;
    try {
      await fs.access(probe);
      return `./${candidate}`;
    } catch {
      // keep shrinking the suffix
    }
  }
  return undefined;
}

/**
 * Resolve `filePath` against the active file root and confine it there.
 * Returns the resolved absolute path, or throws a CORRECTIVE traversal error:
 * the rejection names the working root, restates the relative-path rule, and
 * points at the existing in-root path when one matches a suffix of the
 * rejected path. Exported for the corrective-guard tests.
 */
export async function confinePath(filePath: string): Promise<string> {
  const allowedBase = getFileRoot();
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(allowedBase, filePath);
  if (path.normalize(resolved).startsWith(path.normalize(allowedBase))) {
    return resolved;
  }
  const suggestion = await existingSuffixUnder(allowedBase, filePath);
  const basename = path.basename(filePath) || "output.txt";
  const correction =
    suggestion !== undefined
      ? `"${suggestion}" exists under the root — retry with that exact path.`
      : `Use a relative path instead, e.g. "./${basename}".`;
  throw new Error(
    `Path traversal detected: ${filePath} resolves to ${resolved}, outside the ` +
      `working root ${allowedBase}. Paths are relative to the working root, ` +
      `never the filesystem root. ${correction}`,
  );
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
        "Path to the file to read, RELATIVE to the working root. " +
        "Examples: './output.txt', './data/report.md', './results/data.json'. " +
        "Never invent absolute paths like '/home/user/file.txt' or '/app/file.txt' — " +
        "they resolve outside the working root and the call is refused.",
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
      // confine the result to it. The rejection is corrective — see confinePath.
      const resolved = await confinePath(filePath);

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
      // Corrective rejection — see confinePath.
      const resolved = await confinePath(requested);

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
        "REQUIRED. Path where the file will be written, RELATIVE to the working root. " +
        "Use 'path', NOT 'file' or 'filename'. " +
        "Examples: './output.txt', './results/report.md', './data.json'. " +
        "If no path is specified in the task, use a sensible default like './output.txt'. " +
        "Never invent absolute paths like '/home/user/output.txt' — they resolve " +
        "outside the working root and the call is refused.",
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

/**
 * Text the HARNESS authored and showed the model in an observation. A model
 * passing one of these back as file CONTENT is always a mistake — these strings
 * are produced by the framework, never by a user or a data source — which is
 * what makes rejecting them exact rather than heuristic.
 *
 *   - `[Tool error: …]`            tool-execution.ts (4 sites), inline-act.ts
 *   - `✓ <tool> completed successfully`   planning/plan-text.ts
 *   - `_tool_result_N`             the scratchpad storage key (original guard)
 *
 * Live witness (bench rw-1, 2026-07-26): the agent wrote a correct
 * `databases.json`, then wrote `'✓ file-write completed successfully'` to the
 * same path, then `'[Tool error: Web search failed: …]'`. `file-write`
 * overwrites, so the run destroyed its own finished deliverable and still
 * reported it produced — the judge saw `JSON Parse error: Unexpected identifier
 * "Tool"`. Refusing the write is what keeps the good artifact on disk.
 */
const HARNESS_ECHO_PATTERNS: ReadonlyArray<{ readonly re: RegExp; readonly what: string }> = [
  { re: /^\[Tool error:/, what: "a tool ERROR message the harness showed you" },
  { re: /^✓ .+ completed successfully$/, what: "a tool SUCCESS message the harness showed you" },
  { re: /^_tool_result_\d+$/, what: "a scratchpad storage key" },
];

/**
 * Why this content must not be written, or `undefined` when it is fine.
 * Exported for the write-boundary tests; used by `fileWriteHandler` below.
 */
export function writeContentRejection(
  filePath: string,
  content: string,
): string | undefined {
  const trimmed = content.trim();
  for (const { re, what } of HARNESS_ECHO_PATTERNS) {
    if (re.test(trimmed)) {
      return (
        `Refusing to write ${what}, not content: ${JSON.stringify(trimmed.slice(0, 80))}. ` +
        `Pass the actual text you want saved. If you meant to save a stored result, ` +
        `recall() it first and pass the returned text.`
      );
    }
  }
  // A `.json` deliverable that does not parse is a guaranteed downstream
  // failure, and writing it makes the run report a corrupt artifact as
  // produced. JSON is the one structured family whose validity is cheaply and
  // authoritatively checkable — `.csv`/`.yaml`/`.xml` are deliberately left
  // alone rather than guessed at. Runs AFTER fence normalization, so a fenced
  // block that parses is already unwrapped by here.
  if (JSON_EXT.has(path.extname(filePath).toLowerCase())) {
    try {
      JSON.parse(trimmed);
    } catch (e) {
      return (
        `Refusing to write ${path.basename(filePath)}: the content is not valid JSON ` +
        `(${e instanceof Error ? e.message : String(e)}). ` +
        `Write the JSON value itself — no prose, no explanation, no code fence.`
      );
    }
  }
  return undefined;
}

export const fileWriteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const filePath = args.path as string;
      const content = normalizeStructuredFileContent(filePath, args.content as string);
      const encoding = (args.encoding as BufferEncoding) ?? "utf-8";

      // Refuse content that cannot be the deliverable — a harness-authored echo,
      // or unparseable JSON. Refusing leaves any correct earlier write intact;
      // writing would silently destroy it.
      const rejection =
        typeof content === "string" ? writeContentRejection(filePath, content) : undefined;
      if (rejection !== undefined) throw new Error(rejection);

      // Resolve RELATIVE paths against the active file root (default cwd; the
      // bench/sandbox sets a temp dir via withFileRoot) and confine writes to
      // it — so a model-invented "report.md" lands in the sandbox, not the cwd.
      // The rejection is corrective — see confinePath.
      const resolved = await confinePath(filePath);

      const parent = path.dirname(resolved);
      await fs.mkdir(parent, { recursive: true });

      await fs.writeFile(resolved, content, { encoding });
      return { written: true, path: resolved };
    },
    catch: toToolError("file-write", "File write"),
  });
