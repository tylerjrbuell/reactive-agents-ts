import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { renderValue, type ResultFormat } from "./render-result.js";

/**
 * Overhaul tool — `write_result_to_file`.
 *
 * The reference-protocol path (#2): the model orchestrates by NAMING a stored
 * result + a destination; the SYSTEM materializes the full data and writes it.
 * The model never transcribes the data, never copies a `[STORED:]` marker.
 *
 * Reads the same scratchpad store `recall` uses (large tool results are auto-
 * stored under `_tool_result_*`). Resolves `result_ref` → full value →
 * deterministic render → file. Fixes the array-overflow / marker-copy failure
 * across tiers (validated by the reference-protocol spike).
 */
export const writeResultToFileTool: ToolDefinition = {
  name: "write_result_to_file",
  description:
    "Write a STORED tool result to a file BY REFERENCE — the system materializes the full data, you never retype it or copy a preview/marker. " +
    "Use this whenever a task asks you to save/write a previous tool result (e.g. a list of commits/issues/files) to a file. " +
    "Params: result_ref (the stored id, e.g. '_tool_result_1'), path (destination), format ('bullets' | 'json' | 'table' | 'lines'; default 'bullets').",
  parameters: [
    {
      name: "result_ref",
      type: "string",
      description: "The stored result reference id, e.g. '_tool_result_1'.",
      required: true,
    },
    {
      name: "path",
      type: "string",
      description: "Destination file path, e.g. './out.md'.",
      required: true,
    },
    {
      name: "format",
      type: "string",
      description: "'bullets' (default) | 'json' | 'table' | 'lines'.",
      required: false,
      default: "bullets",
    },
  ],
  returnType: "{ written: true, path: string, ref: string, bytes: number, items: number }",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
  category: "data",
};

export const makeWriteResultToFileHandler =
  (storeRef: Ref.Ref<Map<string, string>>) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const ref = args.result_ref as string | undefined;
      const filePath = args.path as string | undefined;
      const format = ((args.format as string | undefined) ?? "bullets") as ResultFormat;

      if (!ref || typeof ref !== "string") {
        return yield* Effect.fail(
          new ToolExecutionError({
            toolName: "write_result_to_file",
            message: "result_ref is required (the stored id, e.g. '_tool_result_1').",
          }),
        );
      }
      if (!filePath || typeof filePath !== "string") {
        return yield* Effect.fail(
          new ToolExecutionError({
            toolName: "write_result_to_file",
            message: "path is required.",
          }),
        );
      }

      const store = yield* Ref.get(storeRef);
      const raw = store.get(ref);
      if (raw === undefined) {
        // Honest failure (#3) — do NOT write a placeholder. Surface the miss with
        // the available ids so the model can correct.
        const available = [...store.keys()].filter((k) => k.startsWith("_tool_result"));
        return yield* Effect.fail(
          new ToolExecutionError({
            toolName: "write_result_to_file",
            message: `No stored result for result_ref="${ref}". Available: ${available.join(", ") || "(none)"}.`,
          }),
        );
      }

      // Stored values are JSON strings; parse then render. Fall back to raw text.
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        /* not JSON — render the raw string */
      }
      const rendered = renderValue(value, format);
      const itemCount = rendered.length > 0 ? rendered.split("\n").length : 0;

      const resolved = path.resolve(filePath);
      yield* Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, rendered, { encoding: "utf-8" });
        },
        catch: (e) =>
          new ToolExecutionError({
            toolName: "write_result_to_file",
            message: `Failed to write ${resolved}: ${e instanceof Error ? e.message : String(e)}`,
          }),
      });

      return {
        written: true,
        path: filePath,
        ref,
        format,
        bytes: rendered.length,
        items: itemCount,
      };
    });
