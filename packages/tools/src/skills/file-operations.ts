import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

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

      // Security: resolve path and check it's within allowed directory
      const resolved = path.resolve(filePath);
      const allowedBase = process.cwd();
      const normalizedBase = path.normalize(allowedBase);
      const normalizedResolved = path.normalize(resolved);

      if (!normalizedResolved.startsWith(normalizedBase)) {
        throw new Error(
          `Path traversal detected: ${filePath} resolves to ${resolved} outside of ${allowedBase}`,
        );
      }

      // Retry logic with exponential backoff (up to 3 attempts)
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await fs.readFile(resolved, { encoding });
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt < 3) {
            // Exponential backoff: 100ms, 200ms
            const delayMs = 100 * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      throw lastError;
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `File read failed: ${e}`,
        toolName: "file-read",
        cause: e,
      }),
  });

export const fileWriteTool: ToolDefinition = {
  name: "file-write",
  description:
    "Write text to a file, creating it if it does not exist (overwrites any existing content). " +
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
};

export const fileWriteHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const filePath = args.path as string;
      const content = args.content as string;
      const encoding = (args.encoding as BufferEncoding) ?? "utf-8";

      // Guard: model passed a stored-result key instead of the actual content.
      if (/^_tool_result_\d+$/.test(content?.trim?.())) {
        throw new Error(
          `"${content}" is a storage key, not a value. ` +
          `Use recall("${content}") first, then pass the returned text as the content argument.`,
        );
      }

      const resolved = path.resolve(filePath);
      const allowedBase = process.cwd();
      if (!resolved.startsWith(allowedBase)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

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
