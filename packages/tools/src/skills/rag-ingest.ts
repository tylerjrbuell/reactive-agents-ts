import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { detectAndLoad, loadText, loadMarkdown, loadJSON, loadCSV, loadHTML } from "../rag/loaders.js";
import type { ChunkConfig, DocumentChunk } from "../rag/types.js";

export const ragIngestTool: ToolDefinition = {
  name: "rag-ingest",
  description:
    "Load and index a document for semantic search. Supports text, markdown, JSON, CSV, and HTML. " +
    "The document will be chunked, embedded, and stored in semantic memory for later retrieval via rag-search. " +
    "IMPORTANT: use 'content' and 'source' parameters. Returns the number of chunks stored.",
  parameters: [
    {
      name: "content",
      type: "string",
      description:
        "The full document content to ingest. Can be text, markdown, JSON, CSV, or HTML.",
      required: true,
    },
    {
      name: "source",
      type: "string",
      description:
        "Source identifier for the document (file path or URL). Used to tag chunks for filtering.",
      required: true,
    },
    {
      name: "format",
      type: "string",
      description:
        "Document format: text, markdown, json, csv, html. Auto-detected from source extension or content if omitted.",
      required: false,
      enum: ["text", "markdown", "json", "csv", "html"],
    },
    {
      name: "chunkStrategy",
      type: "string",
      description:
        "Chunking strategy: fixed, sentence, paragraph, markdown-sections. Default: paragraph.",
      required: false,
      default: "paragraph",
      enum: ["fixed", "sentence", "paragraph", "markdown-sections"],
    },
    {
      name: "maxChunkSize",
      type: "number",
      description: "Maximum chunk size in characters. Default: 1000.",
      required: false,
      default: 1000,
    },
  ],
  returnType:
    "{ ingested: true, source: string, chunksStored: number, format: string }",
  category: "data",
  riskLevel: "low",
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
};

/**
 * Handler factory for rag-ingest. Accepts a store callback that persists chunks
 * into semantic memory. The callback receives the chunks and returns a count.
 *
 * By default (no storeCallback), chunks are stored in an in-memory map for retrieval
 * via rag-search. When wired into the full runtime, the execution engine provides
 * a callback that writes through to SemanticMemoryService.
 */
export type RagStoreCallback = (
  chunks: DocumentChunk[],
) => Effect.Effect<number, ToolExecutionError>;

export const makeRagIngestHandler =
  (storeCallback: RagStoreCallback) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> => {
    const content = args.content as string | undefined;
    const source = args.source as string | undefined;
    const format = args.format as string | undefined;
    const chunkStrategy = args.chunkStrategy as ChunkConfig["strategy"] | undefined;
    const maxChunkSize = args.maxChunkSize as number | undefined;

    if (!content || typeof content !== "string") {
      return Effect.fail(
        new ToolExecutionError({
          message: 'Missing required parameter "content" (must be a non-empty string)',
          toolName: "rag-ingest",
        }),
      );
    }

    if (!source || typeof source !== "string") {
      return Effect.fail(
        new ToolExecutionError({
          message: 'Missing required parameter "source" (must be a non-empty string)',
          toolName: "rag-ingest",
        }),
      );
    }

    return Effect.gen(function* () {
      // Build chunk config
      const config: ChunkConfig = {
        maxChunkSize: maxChunkSize ?? 1000,
        chunkOverlap: 200,
        strategy: chunkStrategy ?? "paragraph",
      };

      // Load and chunk the document
      let chunks: DocumentChunk[];
      if (format) {
        // Use explicit format loader
        switch (format) {
          case "markdown":
            chunks = loadMarkdown(content, source, config);
            break;
          case "json":
            chunks = loadJSON(content, source, config);
            break;
          case "csv":
            chunks = loadCSV(content, source, config);
            break;
          case "html":
            chunks = loadHTML(content, source, config);
            break;
          default:
            chunks = loadText(content, source, config);
        }
      } else {
        chunks = detectAndLoad(content, source, config);
      }

      if (chunks.length === 0) {
        return {
          ingested: true,
          source,
          chunksStored: 0,
          format: format ?? "text",
          message: "Document was empty or produced no chunks.",
        };
      }

      // Store chunks via callback
      const stored = yield* storeCallback(chunks);

      return {
        ingested: true,
        source,
        chunksStored: stored,
        format: chunks[0]!.metadata.format,
      };
    });
  };

/**
 * Default in-memory store for RAG chunks. Shared between ingest and search tools.
 * In the full runtime, this is replaced by SemanticMemoryService.
 */
export type RagMemoryStore = Map<string, DocumentChunk[]>;

/**
 * Create a default store callback that saves chunks to an in-memory map.
 */
export function makeInMemoryStoreCallback(
  store: RagMemoryStore,
): RagStoreCallback {
  return (chunks) =>
    Effect.succeed((() => {
      if (chunks.length === 0) return 0;
      const source = chunks[0]!.metadata.source;
      const existing = store.get(source) ?? [];
      store.set(source, [...existing, ...chunks]);
      return chunks.length;
    })());
}
