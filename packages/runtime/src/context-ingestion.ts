import { Effect } from "effect";
import { readFileSync } from "fs";
import type { RagMemoryStore } from "@reactive-agents/tools";
import {
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
} from "@reactive-agents/tools";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { fetchDocument, hasUrlScheme, isHttpUrl } from "./document-fetch.js";
import type { FetchLike, HostLookup } from "./document-fetch.js";

/** Optional ingestion knobs. */
export interface IngestOptions {
  /** Injectable fetch for http(s) sources (tests); defaults to global fetch. */
  readonly fetch?: FetchLike;
  /** Injectable DNS lookup for the private-host guard (tests). */
  readonly lookup?: HostLookup;
}

const SITE = "runtime/src/context-ingestion.ts:ingestDocuments";

/** Emit a structured, observable ingestion failure naming source + reason. */
const ingestFailed = (source: string, reason: string): Effect.Effect<void> =>
  emitErrorSwallowed({
    site: SITE,
    tag: "DocumentIngestFailed",
    message: `${source}: ${reason}`,
  });

/**
 * Specification for a document to ingest into the RAG memory store.
 *
 * When `content` is omitted, `source` is loaded: http(s) URLs are fetched
 * (10s timeout, 2 MB cap, html/markdown/text/json only, private hosts blocked
 * unless `allowPrivateHosts`); other values are read
 * as file paths. Any failure emits an `ErrorSwallowed` event with tag
 * `DocumentIngestFailed` and `message` "<source>: <reason>".
 *
 * @example
 * ```typescript
 * // Inline content
 * const doc: DocumentSpec = {
 *   content: "The capital of France is Paris.",
 *   source: "facts.txt",
 * };
 *
 * // Read from file path (content omitted)
 * const fileDoc: DocumentSpec = {
 *   source: "./docs/README.md",
 *   format: "markdown",
 * };
 * ```
 */
export interface DocumentSpec {
  /**
   * The full document content to ingest.
   * When omitted, the file at `source` is read from disk.
   */
  readonly content?: string;
  /** Source identifier (file path or label) — used to tag chunks for retrieval. */
  readonly source: string;
  /** Document format: text, markdown, json, csv, html. Auto-detected if omitted. */
  readonly format?: string;
  /** Chunking strategy: fixed, sentence, paragraph, markdown-sections. Default: paragraph. */
  readonly chunkStrategy?: string;
  /** Maximum chunk size in characters. Default: 1000. */
  readonly maxChunkSize?: number;
  /**
   * Allow this http(s) `source` to resolve to a loopback / link-local / private
   * address (e.g. a local docs server). Default `false`: such targets, and
   * redirects to them, are rejected as `DocumentIngestFailed` (SSRF guard).
   */
  readonly allowPrivateHosts?: boolean;
}

/**
 * Ingest documents into the RAG memory store.
 *
 * Processes each document through the RAG loader/chunker pipeline and stores
 * the resulting chunks for later retrieval via the `find` tool.
 *
 * @param docs - Array of documents to ingest
 * @param store - The in-memory RAG store (searched by the `find` tool)
 * @param options - Optional injectable fetch
 * @returns Effect that completes when all documents are ingested
 */
export function ingestDocuments(
  docs: readonly DocumentSpec[],
  store: RagMemoryStore,
  options?: IngestOptions,
): Effect.Effect<void> {
  if (docs.length === 0) return Effect.void;

  const handler = makeRagIngestHandler(makeInMemoryStoreCallback(store));

  return Effect.forEach(
    docs,
    (doc) =>
      Effect.gen(function* () {
        let content: string;
        let format = doc.format;
        if (doc.content !== undefined) {
          content = doc.content;
        } else if (isHttpUrl(doc.source)) {
          const r = yield* Effect.promise(() =>
            fetchDocument(doc.source, {
              ...(options?.fetch ? { fetch: options.fetch } : {}),
              ...(options?.lookup ? { lookup: options.lookup } : {}),
              allowPrivateHosts: doc.allowPrivateHosts === true,
            }),
          );
          if (!r.ok) return yield* ingestFailed(doc.source, r.reason);
          content = r.content;
          format = format ?? r.format;
        } else if (hasUrlScheme(doc.source)) {
          return yield* ingestFailed(doc.source, "unsupported URL scheme (only http/https)");
        } else {
          try {
            content = readFileSync(doc.source, "utf8");
          } catch (e) {
            return yield* ingestFailed(doc.source, `unreadable file: ${(e as { message?: string }).message ?? String(e)}`);
          }
        }
        yield* handler({
          content,
          source: doc.source,
          ...(format ? { format } : {}),
          ...(doc.chunkStrategy ? { chunkStrategy: doc.chunkStrategy } : {}),
          ...(doc.maxChunkSize ? { maxChunkSize: doc.maxChunkSize } : {}),
        }).pipe(
          Effect.asVoid,
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/context-ingestion.ts:82", tag: errorTag(err), message: doc.source }),
          ),
        );
      }),
    { discard: true },
  );
}
