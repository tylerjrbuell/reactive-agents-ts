import { Effect, Context, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MemoryError } from "../errors.js";
import {
  MEMORY_DIR_MODE,
  MEMORY_FILE_MODE,
  safeAgentPathSegment,
} from "../path-safety.js";

// ─── Service Tag ───

export class MemoryFileSystem extends Context.Tag("MemoryFileSystem")<
  MemoryFileSystem,
  {
    /** Write memory.md projection for an agent. */
    readonly writeMarkdown: (
      agentId: string,
      content: string,
      basePath: string,
    ) => Effect.Effect<void, MemoryError>;

    /** Read memory.md for bootstrap. Returns empty string if not found. */
    readonly readMarkdown: (
      agentId: string,
      basePath: string,
    ) => Effect.Effect<string, MemoryError>;

    /** Ensure agent memory directory exists. */
    readonly ensureDirectory: (
      agentId: string,
      basePath: string,
    ) => Effect.Effect<void, MemoryError>;
  }
>() {}

// ─── Live Implementation ───

export const MemoryFileSystemLive = Layer.succeed(MemoryFileSystem, {
  writeMarkdown: (agentId, content, basePath) =>
    Effect.tryPromise({
      try: async () => {
        const dir = path.join(basePath, safeAgentPathSegment(agentId));
        await fs.mkdir(dir, { recursive: true, mode: MEMORY_DIR_MODE });
        await fs.writeFile(path.join(dir, "memory.md"), content, {
          encoding: "utf8",
          mode: MEMORY_FILE_MODE,
        });
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to write memory.md: ${e}`,
          cause: e,
        }),
    }),

  readMarkdown: (agentId, basePath) =>
    Effect.tryPromise({
      try: async () => {
        const filePath = path.join(
          basePath,
          safeAgentPathSegment(agentId),
          "memory.md",
        );
        try {
          return await fs.readFile(filePath, "utf8");
        } catch {
          return "";
        }
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to read memory.md: ${e}`,
          cause: e,
        }),
    }),

  ensureDirectory: (agentId, basePath) =>
    Effect.tryPromise({
      try: async () => {
        await fs.mkdir(path.join(basePath, safeAgentPathSegment(agentId)), {
          recursive: true,
          mode: MEMORY_DIR_MODE,
        });
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to create memory directory: ${e}`,
          cause: e,
        }),
    }),
});
