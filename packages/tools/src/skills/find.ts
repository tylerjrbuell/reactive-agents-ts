import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import type { RagMemoryStore } from "./rag-ingest.js";
import { makeInMemorySearchCallback } from "./rag-search.js";

export interface FindConfig {
  autoStoreThreshold?: number;
  minRagScore?: number;
  webFallback?: boolean;
  preferredScope?: "documents" | "web";
}

export interface FindState {
  ragStore: RagMemoryStore;
  webSearchHandler?: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
  bootstrapMemoryContent?: string;
  recallStoreRef: Ref.Ref<Map<string, string>>;
  config: FindConfig;
}

export const findTool: ToolDefinition = {
  name: "find",
  description:
    "Unified intelligent search. Finds information from any available source. " +
    "scope defaults to 'auto': tries indexed documents first, falls back to web if no results. " +
    "scope options: 'auto' | 'documents' | 'web' | 'memory' | 'all'. " +
    "'memory' searches the bootstrapped semantic memory lines (already in your context). " +
    "Use this instead of choosing between rag-search and web-search.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "What you are looking for.",
      required: true,
    },
    {
      name: "scope",
      type: "string",
      description: "Where to search: 'auto' (default), 'documents', 'web', 'memory', 'all'.",
      required: false,
      default: "auto",
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
  category: "search",
};

export const makeFindHandler =
  (state: FindState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const query = args.query as string | undefined;
      if (!query || typeof query !== "string") {
        return yield* Effect.fail(
          new ToolExecutionError({ message: 'find requires a "query" parameter', toolName: "find" }),
        );
      }

      const scope = (args.scope as string | undefined) ?? "auto";
      const minRagScore = state.config.minRagScore ?? 0.1;
      const autoStoreThreshold = state.config.autoStoreThreshold ?? 800;
      const webFallback = state.config.webFallback ?? true;

      const sourcesSearched: string[] = [];
      const allResults: Array<{
        content: string;
        source: "documents" | "web" | "memory";
        identifier: string;
        score: number;
        chunkIndex?: number;
      }> = [];

      // ── Documents (RAG) search
      const shouldSearchDocs = scope === "auto" || scope === "documents" || scope === "all";
      if (shouldSearchDocs && state.ragStore.size > 0) {
        sourcesSearched.push("documents");
        const searchCallback = makeInMemorySearchCallback(state.ragStore);
        const ragResults = yield* searchCallback(query, 5, undefined).pipe(
          Effect.catchAll(() => Effect.succeed([])),
        );
        const hits = ragResults.filter((r) => r.score >= minRagScore);
        for (const r of hits) {
          allResults.push({
            content: r.content,
            source: "documents",
            identifier: r.source,
            score: r.score,
            chunkIndex: r.chunkIndex,
          });
        }
        // Short-circuit for auto if we got RAG hits
        if (scope === "auto" && hits.length > 0) {
          return yield* buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
        }
      }

      // ── Memory search (bootstrapped semantic context)
      const shouldSearchMemory = scope === "memory" || scope === "all";
      if (shouldSearchMemory && state.bootstrapMemoryContent) {
        sourcesSearched.push("memory");
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const lines = state.bootstrapMemoryContent.split("\n").filter(l => l.trim().length > 0);
        const memMatches = lines.filter(line =>
          terms.some(term => line.toLowerCase().includes(term))
        ).slice(0, 5);
        for (const line of memMatches) {
          allResults.push({ content: line, source: "memory", identifier: "memory-bootstrap", score: 0.4 });
        }
        if (scope === "memory") {
          return yield* buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
        }
      }

      // ── Web search
      const shouldSearchWeb =
        scope === "web" ||
        scope === "all" ||
        (scope === "auto" && webFallback && allResults.length === 0);

      if (shouldSearchWeb && state.webSearchHandler) {
        sourcesSearched.push("web");
        const webResult = yield* state.webSearchHandler({ query }).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (webResult && typeof webResult === "object") {
          const results = (webResult as any).results ?? [];
          for (const r of results) {
            allResults.push({
              content: r.snippet ?? r.content ?? "",
              source: "web",
              identifier: r.url ?? r.link ?? "",
              score: 0.5,
            });
          }
        }
      }

      return yield* buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
    });

function buildFindResponse(
  query: string,
  results: Array<{ content: string; source: string; identifier: string; score: number; chunkIndex?: number }>,
  sourcesSearched: string[],
  autoStoreThreshold: number,
  recallStoreRef: Ref.Ref<Map<string, string>>,
): Effect.Effect<unknown, never> {
  return Effect.gen(function* () {
    const totalContent = results.map((r) => r.content).join(" ");
    let storedAs: string | undefined;

    if (totalContent.length > autoStoreThreshold && results.length > 0) {
      const key = `_find_${Date.now()}`;
      yield* Ref.update(recallStoreRef, (m) => {
        const next = new Map(m);
        next.set(key, JSON.stringify({ query, results }));
        return next;
      });
      storedAs = key;
      const preview = results.slice(0, 3).map((r) => ({
        ...r,
        content: r.content.slice(0, 200),
      }));
      return { query, results: preview, totalResults: results.length, sourcesSearched, storedAs };
    }

    return { query, results, totalResults: results.length, sourcesSearched, storedAs };
  });
}
