import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import type { DocumentChunk } from "../rag/types.js";

export const ragSearchTool: ToolDefinition = {
  name: "rag-search",
  description:
    "Search ingested documents using semantic similarity or keyword matching. " +
    "Returns the most relevant document chunks for a query. " +
    "Documents must first be loaded with rag-ingest before they can be searched.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query — describe what information you are looking for.",
      required: true,
    },
    {
      name: "topK",
      type: "number",
      description: "Number of results to return. Default: 5.",
      required: false,
      default: 5,
    },
    {
      name: "source",
      type: "string",
      description:
        "Filter results to chunks from a specific source document (the source identifier used during ingest).",
      required: false,
    },
  ],
  returnType:
    "{ query: string, results: Array<{ content: string, source: string, chunkIndex: number, score: number }> }",
  category: "search",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
};

/**
 * Search result from RAG retrieval.
 */
export type RagSearchResult = {
  content: string;
  source: string;
  chunkIndex: number;
  score: number;
};

/**
 * Search callback type — implementations can use vector search, FTS, or keyword matching.
 */
export type RagSearchCallback = (
  query: string,
  topK: number,
  source?: string,
) => Effect.Effect<RagSearchResult[], ToolExecutionError>;

export const makeRagSearchHandler =
  (searchCallback: RagSearchCallback) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> => {
    const query = args.query as string | undefined;
    const topK = (args.topK as number) ?? 5;
    const source = args.source as string | undefined;

    if (!query || typeof query !== "string") {
      return Effect.fail(
        new ToolExecutionError({
          message: 'Missing required parameter "query" (must be a non-empty string)',
          toolName: "rag-search",
        }),
      );
    }

    return Effect.gen(function* () {
      const results = yield* searchCallback(query, topK, source);

      return {
        query,
        results,
        totalResults: results.length,
      };
    });
  };

/**
 * Create a default keyword-based search callback over an in-memory store.
 * Scores chunks by term frequency (TF) relevance — simple but functional.
 */
export function makeInMemorySearchCallback(
  store: Map<string, DocumentChunk[]>,
): RagSearchCallback {
  return (query, topK, source) =>
    Effect.succeed((() => {
      const queryTerms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);

      if (queryTerms.length === 0) return [];

      // Collect all chunks, optionally filtered by source
      const allChunks: DocumentChunk[] = [];
      for (const [key, chunks] of store) {
        if (source && key !== source) continue;
        allChunks.push(...chunks);
      }

      // Score each chunk by term frequency
      const scored = allChunks.map((chunk) => {
        const lower = chunk.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          // Count occurrences
          let idx = 0;
          let count = 0;
          while ((idx = lower.indexOf(term, idx)) !== -1) {
            count++;
            idx += term.length;
          }
          score += count;
        }
        // Normalize by chunk length (prefer concise relevant chunks)
        const normalizedScore = chunk.content.length > 0
          ? score / Math.sqrt(chunk.content.length)
          : 0;

        return {
          content: chunk.content,
          source: chunk.metadata.source,
          chunkIndex: chunk.metadata.chunkIndex,
          score: normalizedScore,
        };
      });

      // Sort by score descending, take topK, exclude zero-score
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    })());
}
