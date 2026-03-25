import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export interface RecallConfig {
  previewLength?: number;
  autoFullThreshold?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
}

export const recallTool: ToolDefinition = {
  name: "recall",
  description:
    "Your working memory for this run. Four modes: " +
    "WRITE — recall(key, content) stores anything worth keeping across steps; " +
    "READ — recall(key) retrieves a stored entry (compact preview by default, full: true for complete content); " +
    "SEARCH — recall(query=...) finds entries by keyword when you don't remember the key name; " +
    "LIST — recall() with no args shows all stored entries with sizes and previews. " +
    "Large tool results are auto-stored as _tool_result_N keys — use recall() to list or search them. " +
    "Store key findings, plans, and intermediate results here to avoid losing them to context compression.",
  parameters: [
    {
      name: "key",
      type: "string",
      description: "Storage key for write or read.",
      required: false,
    },
    {
      name: "content",
      type: "string",
      description: "Content to store. Presence of both key+content triggers write mode.",
      required: false,
    },
    {
      name: "query",
      type: "string",
      description: "Keyword search across all stored entries. Triggers search mode.",
      required: false,
    },
    {
      name: "full",
      type: "boolean",
      description: "Return full content on read (default: compact preview).",
      required: false,
      default: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
  category: "data",
};

export const makeRecallHandler =
  (storeRef: Ref.Ref<Map<string, string>>, config?: RecallConfig) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const previewLength = config?.previewLength ?? 200;
      const autoFullThreshold = config?.autoFullThreshold ?? 300;

      const key = args.key as string | undefined;
      const content = args.content as string | undefined;
      const query = args.query as string | undefined;
      const full = args.full as boolean | undefined;

      // ── Write mode
      if (key !== undefined && content !== undefined) {
        yield* Ref.update(storeRef, (m) => {
          const next = new Map(m);
          next.set(key, content);
          return next;
        });
        return {
          saved: true,
          key,
          bytes: content.length,
          preview: content.slice(0, previewLength),
        };
      }

      const store = yield* Ref.get(storeRef);

      // ── Search mode
      if (query !== undefined) {
        const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        if (terms.length === 0) return { query, matches: [], totalMatches: 0 };

        const matches = [...store.entries()]
          .map(([k, v]) => {
            const lower = v.toLowerCase();
            let score = 0;
            for (const term of terms) {
              let idx = 0;
              while ((idx = lower.indexOf(term, idx)) !== -1) { score++; idx += term.length; }
            }
            const norm = v.length > 0 ? score / Math.sqrt(v.length) : 0;
            return { key: k, excerpt: v.slice(0, previewLength), score: norm };
          })
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score);

        return { query, matches, totalMatches: matches.length };
      }

      // ── Read mode
      if (key !== undefined) {
        const value = store.get(key);
        if (value === undefined) return { found: false, key };
        const returnFull = full || value.length <= autoFullThreshold;
        if (returnFull) return { key, content: value, bytes: value.length, truncated: false };
        return { key, preview: value.slice(0, previewLength), bytes: value.length, truncated: true };
      }

      // ── List mode
      const entries = [...store.entries()].map(([k, v]) => ({
        key: k,
        bytes: v.length,
        preview: v.slice(0, 100),
        type: k.startsWith("_") ? "auto" : "agent",
      }));
      return { entries, totalEntries: entries.length, totalBytes: entries.reduce((s, e) => s + e.bytes, 0) };
    });
