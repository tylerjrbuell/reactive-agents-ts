import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const fileReadTool: ToolDefinition = {
  name: "file-read",
  description: "Read the contents of a file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "File path to read",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description: "File encoding",
      required: false,
      default: "utf-8",
    },
  ],
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

      // Security: resolve path and check it's within allowed directory
      const resolved = path.resolve(filePath);
      const allowedBase = process.cwd();
      if (!resolved.startsWith(allowedBase)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      return await fs.readFile(resolved, { encoding });
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
  description: "Write contents to a file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "File path to write",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "Content to write",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description: "File encoding",
      required: false,
      default: "utf-8",
    },
  ],
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
