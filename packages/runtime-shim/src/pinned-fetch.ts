import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  PublicUrlError,
  resolvePublicUrl,
  type AssertPublicUrlOptions,
  type ResolvedPublicUrl,
} from "./assert-public-url.js";

/** Request shape handed to a {@link PinnedTransport}. */
export interface PinnedRequest {
  /** Validated URL. Its hostname is the logical host (Host header, TLS SNI), NOT the connect target. */
  readonly url: URL;
  /** Validated IP to connect to. The transport must open the socket to exactly this address. */
  readonly address: string;
  /** IP family of `address`. */
  readonly family: 4 | 6;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

/** Sends one request to a pinned address. Injectable so tests can observe the connect target. */
export type PinnedTransport = (req: PinnedRequest) => Promise<Response>;

export interface PinnedFetchInit {
  /** HTTP method. Defaults to GET. */
  readonly method?: string;
  /** Request headers. Credential headers are dropped on cross-origin redirect hops. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body (string or bytes). Dropped when a redirect downgrades the method to GET. */
  readonly body?: string | Uint8Array;
  /** Aborts the request. */
  readonly signal?: AbortSignal;
}

export interface PinnedFetchOptions extends AssertPublicUrlOptions {
  /**
   * `"follow"` (default) re-validates and re-pins every redirect hop, up to
   * `maxRedirects`. `"manual"` returns the 3xx response untouched so the caller
   * can drive hops itself (call `fetchPinned` again per hop).
   */
  readonly redirect?: "follow" | "manual";
  /** Maximum redirect hops when following. Defaults to 5; exceeding it throws `PublicUrlError`. */
  readonly maxRedirects?: number;
  /** Override the socket layer (tests). Defaults to a `node:http` / `node:https` transport. */
  readonly transport?: PinnedTransport;
}

const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

const stripCredentials = (h: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));

/**
 * Default transport. Connects to `address` (an IP literal, so Node/Bun perform
 * no DNS lookup) while keeping the logical hostname in the `Host` header and TLS
 * `servername`, so certificate verification still targets the real host.
 */
export const nodePinnedTransport: PinnedTransport = (req) =>
  new Promise<Response>((resolve, reject) => {
    const { url } = req;
    const secure = url.protocol === "https:";
    const headers: Record<string, string> = { "accept-encoding": "identity" };
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
    headers["host"] = url.host;
    const logicalHost = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    const options: https.RequestOptions = {
      host: req.address,
      port: url.port !== "" ? Number(url.port) : secure ? 443 : 80,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
      signal: req.signal,
      ...(secure && isIP(logicalHost) === 0 ? { servername: logicalHost } : {}),
    };
    const clientReq = (secure ? https : http).request(options, (res) => {
      const responseHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) for (const item of v) responseHeaders.append(k, item);
        else if (v !== undefined) responseHeaders.set(k, v);
      }
      const status = res.statusCode ?? 502;
      const noBody = NULL_BODY_STATUS.has(status) || req.method === "HEAD";
      if (noBody) res.resume();
      resolve(
        new Response(noBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), {
          status,
          statusText: res.statusMessage ?? "",
          headers: responseHeaders,
        }),
      );
    });
    clientReq.on("error", reject);
    if (req.body !== undefined) clientReq.write(req.body);
    clientReq.end();
  });

/**
 * SSRF-safe `fetch` for user-controlled URLs. Per hop it resolves DNS ONCE,
 * validates every answer against the {@link assertPublicUrl} blocklist, and
 * connects to that validated address (Host and TLS SNI keep the real hostname),
 * so a second, rebound DNS answer can never redirect the request. Redirects are
 * re-validated and re-pinned hop by hop (default) or returned untouched
 * (`redirect: "manual"`).
 *
 * Rejects with {@link PublicUrlError} (`_tag: "PublicUrlError"`) when a URL or
 * redirect target is refused or the hop cap is exceeded; transport failures
 * reject with the underlying error. Wrap with `Effect.tryPromise` at the call
 * site. Responses are not decompressed (`accept-encoding: identity` is sent).
 * Does not honour proxy environment variables.
 */
export async function fetchPinned(
  rawUrl: string,
  init: PinnedFetchInit = {},
  opts: PinnedFetchOptions = {},
): Promise<Response> {
  const transport = opts.transport ?? nodePinnedTransport;
  const maxRedirects = opts.maxRedirects ?? 5;
  let method = (init.method ?? "GET").toUpperCase();
  let headers: Record<string, string> = { ...init.headers };
  let body = init.body;
  let target: string = rawUrl;

  for (let hop = 0; ; hop++) {
    const pinned: ResolvedPublicUrl = await resolvePublicUrl(target, opts);
    const response = await transport({
      url: pinned.url,
      address: pinned.address,
      family: pinned.family,
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location !== null;
    if (!isRedirect || opts.redirect === "manual") return response;

    await response.body?.cancel();
    if (hop >= maxRedirects) {
      throw new PublicUrlError(`fetchPinned: exceeded ${maxRedirects} redirects`);
    }
    const next = new URL(location, pinned.url);
    if (next.origin !== pinned.url.origin) headers = stripCredentials(headers);
    // 303 always, and 301/302 for POST, become body-less GET (fetch semantics).
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
    }
    target = next.toString();
  }
}
