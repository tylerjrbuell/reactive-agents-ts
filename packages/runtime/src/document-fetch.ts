/**
 * HTTP(S) document fetching for `.withDocuments()` / `agent.ingest()` sources.
 *
 * Returns a discriminated result (never throws) so the caller can emit a
 * structured, observable failure instead of silently dropping the source.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Injectable fetch signature (global `fetch` by default; swapped in tests). */
export type FetchLike = (
  url: string,
  init?: {
    readonly signal?: AbortSignal;
    readonly headers?: Record<string, string>;
    readonly redirect?: "manual" | "follow";
  },
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

/** Maximum redirect hops followed (each hop is re-checked by the host guard). */
export const DOCUMENT_FETCH_MAX_REDIRECTS = 5;

/** Injectable DNS lookup: hostname to resolved IP address strings. */
export type HostLookup = (hostname: string) => Promise<readonly string[]>;

const defaultLookup: HostLookup = async (hostname) => {
  const all = await dnsLookup(hostname, { all: true });
  return all.map((a) => a.address);
};

/** Fetch knobs. */
export interface FetchDocumentOptions {
  /** Injectable fetch (defaults to global `fetch`). */
  readonly fetch?: FetchLike;
  /** Injectable DNS lookup (defaults to `node:dns` lookup). */
  readonly lookup?: HostLookup;
  /**
   * Permit loopback / link-local / private-range targets (e.g. a local docs
   * server). OFF by default: an unguarded fetch can reach cloud metadata
   * endpoints (169.254.169.254) and internal services (SSRF).
   */
  readonly allowPrivateHosts?: boolean;
}

const ipv4Private = (ip: string): boolean => {
  const p = ip.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
};

/** True when `ip` (v4 or v6 literal) is loopback, link-local, private, or reserved. */
export const isPrivateAddress = (ip: string): boolean => {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind !== 6) return false;
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  const hexMapped = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hexMapped?.[1] && hexMapped[2]) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(v.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
};

/**
 * Returns a block reason when `url` targets a private host, else `undefined`.
 * Literal IPs and `localhost` are rejected directly; other hostnames are
 * resolved and rejected if ANY address is private. A failed lookup is not
 * blocked here (the fetch itself then fails to resolve).
 */
const privateHostReason = async (url: string, lookup: HostLookup): Promise<string | undefined> => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "invalid URL";
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const blocked = (h: string) => `blocked private host "${h}" (set allowPrivateHosts to permit)`;
  if (host === "localhost" || host.endsWith(".localhost")) return blocked(host);
  if (isIP(host) !== 0) return isPrivateAddress(host) ? blocked(host) : undefined;
  let addrs: readonly string[];
  try {
    addrs = await lookup(host);
  } catch {
    return undefined;
  }
  return addrs.some(isPrivateAddress) ? blocked(host) : undefined;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch an http(s) document with a 10s timeout and 2 MB cap.
 *
 * Private-host guard: loopback, link-local (incl. 169.254.169.254), RFC1918,
 * and unique-local targets are rejected, including every redirect hop
 * (redirects are followed manually, max 5) unless `allowPrivateHosts`.
 * Residual risk: DNS is resolved separately from the connect, so a rebinding
 * resolver could still differ between check and use.
 *
 * @param url - http(s) URL
 * @param options - injectable fetch/lookup and the private-host opt-in
 */
export async function fetchDocument(
  url: string,
  options: FetchDocumentOptions | FetchLike = {},
): Promise<FetchedDocument | FetchFailure> {
  const opts: FetchDocumentOptions = typeof options === "function" ? { fetch: options } : options;
  const fetchImpl: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const lookup = opts.lookup ?? defaultLookup;
  try {
    const signal = AbortSignal.timeout(DOCUMENT_FETCH_TIMEOUT_MS);
    let current = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      if (opts.allowPrivateHosts !== true) {
        const reason = await privateHostReason(current, lookup);
        if (reason !== undefined) return { ok: false, reason };
      }
      res = await fetchImpl(current, {
        signal,
        redirect: "manual",
        headers: { Accept: "text/html,text/markdown,text/plain,application/json" },
      });
      if (!REDIRECT_STATUSES.has(res.status)) break;
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, reason: `HTTP ${res.status} redirect without location` };
      if (hop >= DOCUMENT_FETCH_MAX_REDIRECTS) {
        return { ok: false, reason: `too many redirects (> ${DOCUMENT_FETCH_MAX_REDIRECTS})` };
      }
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { ok: false, reason: "invalid redirect location" };
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return { ok: false, reason: "unsupported URL scheme (only http/https)" };
      }
      current = next.toString();
    }
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
