import { accessSync, constants } from "node:fs";
import { fetchDocument, isHttpUrl, type DocumentSpec, type FetchedDocument, type FetchFailure } from "@reactive-agents/runtime";

/** One document that could not be loaded for a chat session (the Cortex form of `DocumentIngestFailed`). */
export interface DocumentIngestFailure {
  readonly source: string;
  readonly reason: string;
}

/** Fetch seam; defaults to the runtime's SSRF-guarded `fetchDocument`. Injectable for tests. */
export type DocumentFetcher = (url: string) => Promise<FetchedDocument | FetchFailure>;

/**
 * Per-session cache of fetched `/docs` URL sources, so a rebuilt chat agent
 * (eviction, config change, restart of the cache) does not re-fetch them, and a
 * record of sources that failed to load so the UI can show why.
 *
 * `resolve` returns specs the builder can ingest without touching the network:
 * URL sources become inline `content`; sources that failed are dropped (and
 * recorded) rather than silently retried on every build.
 */
export class SessionDocumentCache {
  private readonly fetched = new Map<string, Map<string, FetchedDocument>>();
  private readonly failed = new Map<string, Map<string, string>>();

  constructor(private readonly fetcher: DocumentFetcher = (url) => fetchDocument(url)) {}

  /** Resolve specs for one session. Never throws; failures are recorded, see {@link failures}. */
  async resolve(sessionId: string, specs: readonly DocumentSpec[]): Promise<DocumentSpec[]> {
    const cache = this.fetched.get(sessionId) ?? new Map<string, FetchedDocument>();
    this.fetched.set(sessionId, cache);
    const failures = new Map<string, string>();
    this.failed.set(sessionId, failures);
    const out: DocumentSpec[] = [];
    for (const spec of specs) {
      if (spec.content !== undefined) {
        out.push(spec);
      } else if (isHttpUrl(spec.source)) {
        let doc = cache.get(spec.source);
        if (!doc) {
          const r = await this.fetcher(spec.source);
          if (!r.ok) {
            failures.set(spec.source, r.reason);
            continue;
          }
          doc = r;
          cache.set(spec.source, doc);
        }
        out.push({ ...spec, content: doc.content, format: spec.format ?? doc.format });
      } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec.source)) {
        failures.set(spec.source, "unsupported URL scheme (only http/https)");
      } else {
        try {
          accessSync(spec.source, constants.R_OK);
          out.push(spec);
        } catch {
          failures.set(spec.source, "unreadable file");
        }
      }
    }
    return out;
  }

  /** Sources that failed on the session's latest build. */
  failures(sessionId: string): DocumentIngestFailure[] {
    return [...(this.failed.get(sessionId) ?? [])].map(([source, reason]) => ({ source, reason }));
  }

  /** Drop everything cached for a session (deleted session). */
  clear(sessionId: string): void {
    this.fetched.delete(sessionId);
    this.failed.delete(sessionId);
  }
}
