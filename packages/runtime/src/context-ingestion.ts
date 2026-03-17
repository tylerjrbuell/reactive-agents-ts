import { Effect } from "effect";
import type { RagMemoryStore } from "@reactive-agents/tools";
import {
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
} from "@reactive-agents/tools";

/**
 * Specification for a document to ingest into the RAG memory store.
 *
 * @example
 * ```typescript
 * const doc: DocumentSpec = {
 *   content: "The capital of France is Paris.",
 *   source: "facts.txt",
 *   format: "text",
 *   chunkStrategy: "paragraph",
 *   maxChunkSize: 1000,
 * };
 * ```
 */
export interface DocumentSpec {
  /** The full document content to ingest. */
  readonly content: string;
  /** Source identifier (file path, URL, or label) — used to tag chunks for retrieval. */
  readonly source: string;
  /** Document format: text, markdown, json, csv, html. Auto-detected if omitted. */
  readonly format?: string;
  /** Chunking strategy: fixed, sentence, paragraph, markdown-sections. Default: paragraph. */
  readonly chunkStrategy?: string;
  /** Maximum chunk size in characters. Default: 1000. */
  readonly maxChunkSize?: number;
}

/**
 * Ingest documents into the RAG memory store.
 *
 * Processes each document through the RAG loader/chunker pipeline and stores
 * the resulting chunks for later retrieval via `rag-search`.
 *
 * @param docs - Array of documents to ingest
 * @param store - The in-memory RAG store (shared with rag-search)
 * @returns Effect that completes when all documents are ingested
 */
export function ingestDocuments(
  docs: readonly DocumentSpec[],
  store: RagMemoryStore,
): Effect.Effect<void> {
  if (docs.length === 0) return Effect.void;

  const handler = makeRagIngestHandler(makeInMemoryStoreCallback(store));

  return Effect.forEach(
    docs,
    (doc) =>
      handler({
        content: doc.content,
        source: doc.source,
        ...(doc.format ? { format: doc.format } : {}),
        ...(doc.chunkStrategy ? { chunkStrategy: doc.chunkStrategy } : {}),
        ...(doc.maxChunkSize ? { maxChunkSize: doc.maxChunkSize } : {}),
      }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
    { discard: true },
  );
}
