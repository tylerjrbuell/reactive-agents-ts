import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export interface CheckpointConfig {
  previewLength?: number;
  maxEntries?: number;
}

export const checkpointTool: ToolDefinition = {
  name: "checkpoint",
  description:
    "Save important intermediate findings that must survive context compaction. Three modes: " +
    "SAVE — checkpoint(label, content) persists a named finding; " +
    "RETRIEVE — checkpoint(label) retrieves a saved finding; " +
    "LIST — checkpoint() with no args shows all saved checkpoints. " +
    "Use this for key insights, critical results, and partial answers you don't want to lose.",
  parameters: [
    {
      name: "label",
      type: "string",
      description: "Name for the checkpoint (used for save or retrieve).",
      required: false,
    },
    {
      name: "content",
      type: "string",
      description: "Content to save. Presence of both label+content triggers save mode.",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
  category: "data",
};

export const makeCheckpointHandler =
  (storeRef: Ref.Ref<Map<string, string>>, config?: CheckpointConfig) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const previewLength = config?.previewLength ?? 200;
      const maxEntries = config?.maxEntries;

      const label = args.label as string | undefined;
      const content = args.content as string | undefined;

      // ── Save mode
      if (label !== undefined && content !== undefined) {
        yield* Ref.update(storeRef, (m) => {
          const next = new Map(m);
          next.set(label, content);

          // Evict oldest entries if over limit
          if (maxEntries !== undefined && next.size > maxEntries) {
            const keys = [...next.keys()];
            for (let i = 0; i < keys.length - maxEntries; i++) {
              next.delete(keys[i]);
            }
          }

          return next;
        });
        return {
          saved: true,
          label,
          bytes: content.length,
          preview: content.slice(0, previewLength),
        };
      }

      const store = yield* Ref.get(storeRef);

      // ── Retrieve mode
      if (label !== undefined) {
        const value = store.get(label);
        if (value === undefined) return { found: false, label };
        return { label, content: value, bytes: value.length };
      }

      // ── List mode
      const entries = [...store.entries()].map(([k, v]) => ({
        label: k,
        bytes: v.length,
        preview: v.slice(0, previewLength),
      }));
      return { entries, count: entries.length };
    });
