/**
 * HTTP(S) document fetching for `.withDocuments()` / `agent.ingest()` sources.
 *
 * Returns a discriminated result (never throws) so the caller can emit a
 * structured, observable failure instead of silently dropping the source.
 */

/** Injectable fetch signature (global `fetch` by default; swapped in tests). */
export type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal; readonly headers?: Record<string, string> },
) => Promise<Response>;

/** Successful fetch: body text plus the loader format to chunk it with. */
export interface FetchedDocument {
  readonly ok: true;
  readonly content: string;
  readonly format: "html" | "markdown" | "text" | "json";
}

/** Failed fetch with a human-readable reason (names the cause, never the body). */
export interface FetchFailure {
  readonly ok: false;
  readonly reason: string;
}

/** Request timeout for document fetches. */
export const DOCUMENT_FETCH_TIMEOUT_MS = 10_000;
/** Maximum accepted body size (2 MB). */
export const DOCUMENT_FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** True when `source` is an http(s) URL. */
export const isHttpUrl = (source: string): boolean => /^https?:\/\//i.test(source);

/** True when `source` looks like a non-file URL scheme (e.g. file://, ftp://). */
export const hasUrlScheme = (source: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(source);

const formatFromContentType = (ct: string): FetchedDocument["format"] | undefined => {
  const t = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  if (t === "text/html" || t === "application/xhtml+xml") return "html";
  if (t === "text/markdown" || t === "text/x-markdown") return "markdown";
  if (t === "text/plain") return "text";
  if (t === "application/json" || t.endsWith("+json")) return "json";
  return undefined;
};

const describeThrown = (e: unknown): { readonly name: string; readonly msg: string } => {
  if (typeof e === "object" && e !== null) {
    const r = e as { name?: unknown; message?: unknown };
    return {
      name: typeof r.name === "string" ? r.name : "",
      msg: typeof r.message === "string" ? r.message : String(e),
    };
  }
  return { name: "", msg: String(e) };
};

/**
 * Fetch an http(s) document with a 10s timeout and 2 MB cap.
 *
 * @param url - http(s) URL
 * @param fetchImpl - injectable fetch (defaults to global `fetch`)
 */
export async function fetchDocument(
  url: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<FetchedDocument | FetchFailure> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(DOCUMENT_FETCH_TIMEOUT_MS),
      headers: { Accept: "text/html,text/markdown,text/plain,application/json" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";
    const format = formatFromContentType(ct);
    if (format === undefined) {
      return { ok: false, reason: `unsupported content-type "${ct || "none"}"` };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > DOCUMENT_FETCH_MAX_BYTES) {
      return { ok: false, reason: `body too large (${declared} bytes > ${DOCUMENT_FETCH_MAX_BYTES})` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: true, content: await res.text(), format };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DOCUMENT_FETCH_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, reason: `body too large (> ${DOCUMENT_FETCH_MAX_BYTES} bytes)` };
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return { ok: true, content: new TextDecoder().decode(buf), format };
  } catch (e) {
    const { name, msg } = describeThrown(e);
    return {
      ok: false,
      reason: name === "TimeoutError" || name === "AbortError" ? `timeout after ${DOCUMENT_FETCH_TIMEOUT_MS}ms` : `network error: ${msg}`,
    };
  }
}
