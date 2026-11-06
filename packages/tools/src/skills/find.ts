import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import type { RagMemoryStore } from "./rag-ingest.js";
import { makeInMemorySearchCallback } from "./rag-search.js";
import { healEnumArg } from "./arg-healing.js";
import { currentScratchpadStore, resolveStore } from "./run-tool-stores.js";
import { currentDocumentStore } from "./document-store.js";

export interface FindConfig {
  autoStoreThreshold?: number;
  minRagScore?: number;
  webFallback?: boolean;
  preferredScope?: "documents" | "web";
}

export interface FindState {
  /**
   * Document store searched for `documents`/`memory`/`auto`/`all` scopes.
   * Omit to resolve the CURRENT agent's store from `documentStoreSlot` at each
   * invocation (isolation then comes from the run-entry binding). An explicitly
   * passed store always wins.
   */
  ragStore?: RagMemoryStore;
  webSearchHandler?: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
  bootstrapMemoryContent?: string;
  /**
   * Live keyword search over persistent memory (e.g. `.withMemory()`'s
   * semantic store), sourced from `AgentMemory.search` (`@reactive-agents/core`)
   * — see `packages/memory`'s adapter. Each hit carries a REAL entry id,
   * which a model can pass to `relate(id)` to walk the memory graph.
   * `bootstrapMemoryContent` (above) is a separate, older flat-text
   * fallback kept for back-compat; when both are present results from
   * each are merged.
   */
  searchMemory?: (
    query: string,
    limit: number,
  ) => Effect.Effect<readonly { id: string; preview: string }[], unknown>;
  /**
   * Recall store for large-result auto-stores. Omit to resolve the CURRENT
   * run's scratchpad from `runToolStoresSlot` at each invocation (run
   * isolation then comes from the run scope).
   */
  recallStoreRef?: Ref.Ref<Map<string, string>>;
  config: FindConfig;
}

/**
 * Companion tools `find`'s description may point at. Each flag is true only
 * when that tool is REGISTERED for the run; an unset flag drops the sentence
 * that names it, so the model is never told to call a tool it cannot see
 * (truthfulness audit 2026-11-06: `relate` was absent in 10/10 real runs that
 * had `find`).
 */
export interface FindDescriptionOptions {
  /** `relate` is registered (memory graph walk by entry id). */
  readonly relate?: boolean;
  /** `recall` is registered (reads a stored result by key). */
  readonly recall?: boolean;
}

/**
 * Build the `find` definition, naming `relate` / `recall` only when the
 * caller registered them. {@link findTool} is the no-companion default.
 */
export const findToolFor = (options: FindDescriptionOptions = {}): ToolDefinition => ({
  name: "find",
  description:
    "Unified search — use this whenever you need to find information. " +
    "Automatically routes to the right source so you don't have to choose. " +
    "scope 'auto' (default): tries indexed documents first, falls back to web if nothing found. " +
    "scope 'documents': search only the documents loaded for this agent. " +
    "scope 'web': search the internet directly. " +
    "scope 'memory': search remembered content from persistent memory plus the documents loaded for this agent. " +
    (options.relate
      ? "Memory results carry a real entry id — pass it to relate(id) to see what else is connected. "
      : "") +
    "scope 'all': search every source and merge results. " +
    "Large result sets return the top 3 previews plus a `storedAs` key that holds the full set" +
    (options.recall ? " — pass that key to recall() to read it." : "."),
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
});

/** Default `find` definition: names no companion tool. Use {@link findToolFor} when relate/recall are registered. */
export const findTool: ToolDefinition = findToolFor();

const FIND_SCOPES = ["auto", "documents", "web", "memory", "all"] as const;
/** Closed table: observed model-invented scope words -> canonical scope. */
const FIND_SCOPE_ALIASES: Readonly<Record<string, string>> = {
  docs: "documents",
  document: "documents",
  files: "documents",
  internet: "web",
  online: "web",
  search: "web",
  everything: "all",
  any: "all",
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

      const scope =
        typeof args.scope === "string"
          ? healEnumArg(args.scope, FIND_SCOPES, FIND_SCOPE_ALIASES).value
          : "auto";
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
      // `scope: "memory"` is included here (not just "auto"/"documents"/"all")
      // because `agent.ingest()` itself labels ingested content with a
      // `source` of "memory" by convention (see DocumentSpec usage), and the
      // bootstrapped-semantic-context branch below is a DIFFERENT, unrelated
      // store that's empty for any fresh agent using only .withDocuments()/
      // .ingest(). Without this, a query like "what's in your memory?" — a
      // reasonable model choice for scope given this tool's own description
      // — dead-ends with zero results and zero fallback, even though the
      // ingested content is sitting right there under scope "documents".
      const shouldSearchDocs =
        scope === "auto" || scope === "documents" || scope === "memory" || scope === "all";
      const ragStore = state.ragStore ?? (yield* currentDocumentStore);
      if (shouldSearchDocs && ragStore.size > 0) {
        sourcesSearched.push("documents");
        const searchCallback = makeInMemorySearchCallback(ragStore);
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

      // ── Memory search
      const shouldSearchMemory = scope === "memory" || scope === "all";
      if (shouldSearchMemory && (state.searchMemory || state.bootstrapMemoryContent)) {
        sourcesSearched.push("memory");

        // Live search first — carries REAL per-entry ids (`relate(id)` needs
        // one of these; the bootstrap-text fallback below never had one).
        if (state.searchMemory) {
          const hits = yield* state.searchMemory(query, 5).pipe(
            Effect.catchAll(() => Effect.succeed([])),
          );
          for (const hit of hits) {
            allResults.push({ content: hit.preview, source: "memory", identifier: hit.id, score: 0.6 });
          }
        }

        // Older flat-text fallback — kept for back-compat with any caller
        // that still constructs FindState with only `bootstrapMemoryContent`.
        if (state.bootstrapMemoryContent) {
          const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
          const lines = state.bootstrapMemoryContent.split("\n").filter(l => l.trim().length > 0);
          const memMatches = lines.filter(line =>
            terms.some(term => line.toLowerCase().includes(term))
          ).slice(0, 5);
          for (const line of memMatches) {
            allResults.push({ content: line, source: "memory", identifier: "memory-bootstrap", score: 0.4 });
          }
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
          const webObj = webResult as Record<string, unknown>;
          const results = (Array.isArray(webObj.results) ? webObj.results : []) as { snippet?: string; content?: string; url?: string; link?: string }[];
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
  explicitRecallStoreRef: Ref.Ref<Map<string, string>> | undefined,
): Effect.Effect<unknown, never> {
  return Effect.gen(function* () {
    const recallStoreRef = yield* resolveStore(explicitRecallStoreRef, currentScratchpadStore);
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
