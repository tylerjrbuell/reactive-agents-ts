import { Effect } from "effect";

import { ToolExecutionError } from "../errors.js";
import type { DocumentChunk } from "../rag/types.js";

// The `rag-search` callable tool was removed in v0.14 (superseded by the unified
// `find` tool). The in-memory search callback below remains LIVE — it is the
// keyword retrieval engine that `find` (makeFindHandler) uses over documents
// loaded via `.withDocuments()` / `agent.ingest()`.

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

      // Collect all chunks, optionally filtered by source.
      // Source filter uses case-insensitive substring match so that short
      // names like "memory" match full paths like "./.agents/MEMORY.md".
      const sourceLower = source?.toLowerCase();
      const allChunks: DocumentChunk[] = [];
      for (const [key, chunks] of store) {
        if (sourceLower && !key.toLowerCase().includes(sourceLower)) continue;
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
