import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError, toToolError } from "../errors.js";
import { getFileRoot } from "./file-operations.js";

// Directories no grep should ever descend into by default — build output,
// dependency trees, and VCS internals are noise for a content search and can
// be enormous (node_modules alone routinely dwarfs the rest of a repo).
const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage", ".cache",
]);

/** Hard ceiling on files scanned regardless of `maxMatches` — defense against
 * a pathological tree (e.g. an accidentally-broad glob over a huge repo)
 * turning one tool call into a multi-minute filesystem walk. */
const MAX_FILES_SCANNED = 5_000;

/** Files above this size are skipped — almost certainly binary or a lockfile,
 * neither of which a line-oriented text search should read. */
const MAX_FILE_BYTES = 2_000_000;

function isExcludedPath(rel: string): boolean {
  return rel.split(path.sep).some((seg) => DEFAULT_EXCLUDE_DIRS.has(seg));
}

export const grepTool: ToolDefinition = {
  name: "grep",
  description:
    "Search file CONTENTS for a regex pattern across many files in one call — the tool to reach " +
    "for instead of reading files one at a time to find where something is defined, used, or " +
    "mentioned. Scoped to a directory and an optional glob file filter. " +
    "Skips node_modules/.git/dist/build/coverage automatically. " +
    "Returns matched lines grouped by file, capped at maxMatches.",
  parameters: [
    {
      name: "pattern",
      type: "string",
      description:
        "JavaScript regex pattern to search for (not a literal string unless you escape regex " +
        "metacharacters). Examples: 'function\\\\s+handleClick', 'TODO', 'export (const|function) grepTool'.",
      required: true,
    },
    {
      name: "path",
      type: "string",
      description: "Directory to search, relative to the working root. Default: '.' (the whole root).",
      required: false,
      default: ".",
    },
    {
      name: "glob",
      type: "string",
      description:
        "Glob filter for which files to search, e.g. '**/*.ts', 'src/**/*.{ts,tsx}', '*.md'. " +
        "Default: '**/*' (all non-excluded files).",
      required: false,
      default: "**/*",
    },
    {
      name: "caseSensitive",
      type: "boolean",
      description: "Case-sensitive match. Default: false.",
      required: false,
      default: false,
    },
    {
      name: "maxMatches",
      type: "number",
      description: "Maximum matched lines to return before truncating. Default: 200.",
      required: false,
      default: 200,
    },
  ],
  returnType:
    "{ matches: { file: string, line: number, text: string }[], totalMatches: number, filesScanned: number, truncated: boolean }",
  category: "file",
  riskLevel: "low",
  timeoutMs: 15_000,
  requiresApproval: false,
  source: "builtin",
  // Read-only — never produces a durable artifact.
  produces: "none",
};

export const grepHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const patternStr = args.pattern as string;
      if (!patternStr || typeof patternStr !== "string") {
        throw new Error("pattern parameter must be a non-empty string");
      }
      const scopePath = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
      const globPattern = typeof args.glob === "string" && args.glob.length > 0 ? args.glob : "**/*";
      const caseSensitive = args.caseSensitive === true;
      const maxMatches =
        typeof args.maxMatches === "number" && args.maxMatches > 0
          ? Math.floor(args.maxMatches)
          : 200;

      // Security: same sandbox confinement as file-read/file-write — a relative
      // scope resolves against (and is confined to) the active file root.
      const allowedBase = getFileRoot();
      const resolvedScope = path.isAbsolute(scopePath)
        ? path.resolve(scopePath)
        : path.resolve(allowedBase, scopePath);
      const normalizedBase = path.normalize(allowedBase);
      if (!path.normalize(resolvedScope).startsWith(normalizedBase)) {
        throw new Error(
          `Path traversal detected: ${scopePath} resolves to ${resolvedScope} outside of ${allowedBase}`,
        );
      }

      let regex: RegExp;
      try {
        regex = new RegExp(patternStr, caseSensitive ? "" : "i");
      } catch (e) {
        throw new Error(
          `Invalid regex pattern "${patternStr}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const glob = new Bun.Glob(globPattern);
      const matches: { file: string; line: number; text: string }[] = [];
      let filesScanned = 0;
      let truncated = false;

      outer: for await (const rel of glob.scan({ cwd: resolvedScope, onlyFiles: true, dot: false })) {
        if (isExcludedPath(rel)) continue;
        if (filesScanned >= MAX_FILES_SCANNED) {
          truncated = true;
          break;
        }
        filesScanned++;

        const abs = path.join(resolvedScope, rel);
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(abs);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;

        let content: string;
        try {
          content = await fs.readFile(abs, "utf-8");
        } catch {
          continue; // binary or unreadable — skip rather than fail the whole search
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i])) continue;
          matches.push({
            file: path.relative(allowedBase, abs),
            line: i + 1,
            text: lines[i].trim().slice(0, 300),
          });
          if (matches.length >= maxMatches) {
            truncated = true;
            break outer;
          }
        }
      }

      return {
        matches,
        totalMatches: matches.length,
        filesScanned,
        truncated,
      };
    },
    catch: toToolError("grep", "Grep search"),
  });
