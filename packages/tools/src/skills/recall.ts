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
    "WRITE — recall(key, content) stores notes, plans, and findings you want to keep across steps; " +
    "READ — recall(key) retrieves a stored entry (compact preview by default, full: true for complete content); " +
    "SEARCH — recall(query=...) finds entries by keyword when you don't remember the key name; " +
    "LIST — recall() with no args shows all stored entries with sizes and previews. " +
    "Use this to preserve intermediate results, working notes, and key findings.",
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
    {
      name: "start",
      type: "number",
      description: "Character offset for segmented read (0-based).",
      required: false,
    },
    {
      name: "maxChars",
      type: "number",
      description: "Max characters to return for segmented read (default: previewLength).",
      required: false,
    },
    {
      name: "lineStart",
      type: "number",
      description: "Line offset for segmented line read (0-based).",
      required: false,
    },
    {
      name: "lineCount",
      type: "number",
      description: "Number of lines to return for segmented line read (default: 40).",
      required: false,
    },
    {
      name: "arrayStart",
      type: "number",
      description: "Start index for JSON array slice retrieval (0-based).",
      required: false,
    },
    {
      name: "arrayCount",
      type: "number",
      description: "Number of JSON array items to return (default: 20).",
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
      const start = typeof args.start === "number" ? Math.max(0, Math.floor(args.start)) : undefined;
      const maxChars =
        typeof args.maxChars === "number" ? Math.max(1, Math.floor(args.maxChars)) : previewLength;
      const lineStart =
        typeof args.lineStart === "number" ? Math.max(0, Math.floor(args.lineStart)) : undefined;
      const lineCount =
        typeof args.lineCount === "number" ? Math.max(1, Math.floor(args.lineCount)) : 40;
      const arrayStart =
        typeof args.arrayStart === "number" ? Math.max(0, Math.floor(args.arrayStart)) : undefined;
      const arrayCount =
        typeof args.arrayCount === "number" ? Math.max(1, Math.floor(args.arrayCount)) : 20;

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
      if (query !== undefined && key === undefined) {
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

        // JSON array slice mode for large structured payloads
        if (arrayStart !== undefined) {
          try {
            const parsed = JSON.parse(value) as unknown;
            if (!Array.isArray(parsed)) {
              return { found: true, key, mode: "array", error: "Stored value is not a JSON array" };
            }
            const items = parsed.slice(arrayStart, arrayStart + arrayCount);
            const totalItems = parsed.length;
            const nextArrayStart = arrayStart + items.length;
            return {
              found: true,
              key,
              mode: "array",
              items,
              totalItems,
              arrayStart,
              arrayCount: items.length,
              hasMore: nextArrayStart < totalItems,
              nextArrayStart,
            };
          } catch {
            return { found: true, key, mode: "array", error: "Stored value is not valid JSON" };
          }
        }

        // Line-range mode for large text payloads
        if (lineStart !== undefined) {
          const lines = value.split("\n");
          const segmentLines = lines.slice(lineStart, lineStart + lineCount);
          const nextLineStart = lineStart + segmentLines.length;
          return {
            found: true,
            key,
            mode: "lines",
            content: segmentLines.join("\n"),
            totalLines: lines.length,
            lineStart,
            lineCount: segmentLines.length,
            hasMore: nextLineStart < lines.length,
            nextLineStart,
          };
        }

        // Character-range mode for large binary-ish / dense text payloads
        if (start !== undefined) {
          const segment = value.slice(start, start + maxChars);
          const nextStart = start + segment.length;
          return {
            found: true,
            key,
            mode: "chars",
            content: segment,
            totalChars: value.length,
            start,
            maxChars: segment.length,
            hasMore: nextStart < value.length,
            nextStart,
          };
        }

        // In-entry keyword search mode (key + query)
        if (query !== undefined) {
          const q = query.toLowerCase().trim();
          if (!q) return { found: true, key, mode: "in-entry-search", matches: [], totalMatches: 0 };
          const lines = value.split("\n");
          const matches = lines
            .map((line, idx) => ({ lineNumber: idx, line }))
            .filter((m) => m.line.toLowerCase().includes(q));
          const limited = matches.slice(0, 50);
          return {
            found: true,
            key,
            mode: "in-entry-search",
            query,
            matches: limited,
            totalMatches: matches.length,
            truncated: matches.length > limited.length,
          };
        }

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
