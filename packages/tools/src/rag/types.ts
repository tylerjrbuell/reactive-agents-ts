/**
 * Shared types for the RAG (Retrieval Augmented Generation) pipeline.
 */

/** A single chunk of a loaded document with provenance metadata. */
export type DocumentChunk = {
  /** The text content of this chunk. */
  content: string;
  /** Metadata describing where this chunk came from. */
  metadata: {
    /** File path or URL where the document was loaded from. */
    source: string;
    /** Detected document format. */
    format: "text" | "markdown" | "json" | "csv" | "html";
    /** Zero-based index of this chunk within the document. */
    chunkIndex: number;
    /** Total number of chunks the document was split into. */
    totalChunks: number;
    /** Optional title extracted from the document (e.g., first heading). */
    title?: string;
  };
};

/** Configuration for the document chunking strategy. */
export type ChunkConfig = {
  /** Maximum chunk size in characters. Default: 1000. */
  maxChunkSize?: number;
  /** Number of overlapping characters between consecutive chunks. Default: 200. */
  chunkOverlap?: number;
  /** Chunking algorithm to use. Default: "paragraph". */
  strategy?: "fixed" | "sentence" | "paragraph" | "markdown-sections";
};
