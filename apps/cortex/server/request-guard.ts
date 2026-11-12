/**
 * Host / Origin allowlist for `/api/*` and `/ws/*`.
 *
 * Cortex has no authentication; its loopback bind is the only wall. A DNS-rebinding page
 * defeats that wall: the browser connects to 127.0.0.1 while the page believes it is talking
 * to `evil.example`. The attack carries that name in `Host` (and `Origin`), so a request
 * whose Host is not a name this server expects, or whose Origin is a foreign site, is
 * refused with 403. No CORS headers are ever added.
 *
 * Allowed `Host`: `localhost`, `127.0.0.1`, `[::1]` (any port), any IP literal (a rebinding
 * page can only reach us through a DNS name), the host of `CORTEX_URL`, and the
 * comma-separated names in `CORTEX_ALLOWED_HOSTS`. Allowed `Origin`: the same names minus
 * bare IP literals other than loopback (a page served from a LAN address must not call a
 * loopback Cortex).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { isLoopbackHost } from "./listen-host.js";

/** What the guard compares against. */
export interface RequestGuardConfig {
  /** Extra lower-case host names (no port) the operator expects (public URL, reverse proxy). */
  readonly extraHosts: readonly string[];
  /** Access token every `/api/*` and `/ws/*` request must present. Unset: no login (loopback only). */
  readonly token?: string;
}

/** Host names (lower-case, no port or brackets) from `CORTEX_URL` and `CORTEX_ALLOWED_HOSTS`; the token from `CORTEX_TOKEN`. */
export function guardConfigFromEnv(env: Readonly<Record<string, string | undefined>>): RequestGuardConfig {
  const extra: string[] = [];
  const url = env.CORTEX_URL?.trim();
  if (url) {
    try {
      extra.push(new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ""));
    } catch {
      /* an invalid CORTEX_URL adds nothing */
    }
  }
  for (const h of (env.CORTEX_ALLOWED_HOSTS ?? "").split(",")) {
    const t = h.trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (t !== "") extra.push(t);
  }
  const token = env.CORTEX_TOKEN?.trim();
  return { extraHosts: extra, ...(token ? { token } : {}) };
}

/** Host name of a `Host` header value (port and IPv6 brackets removed), lower-case. */
export function hostNameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(1, end);
  }
  const colon = h.lastIndexOf(":");
  return colon !== -1 && h.indexOf(":") === colon ? h.slice(0, colon) : h;
}

const isIpLiteral = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");

/** True when the `Host` header names this server. */
export function isAllowedHost(hostHeader: string | null, cfg: RequestGuardConfig): boolean {
  if (hostHeader === null || hostHeader.trim() === "") return false;
  const name = hostNameOf(hostHeader);
  return isLoopbackHost(name) || isIpLiteral(name) || cfg.extraHosts.includes(name);
}

/** True when the `Origin` header (absent is fine: not a browser cross-site request) is this server's own. */
export function isAllowedOrigin(originHeader: string | null, cfg: RequestGuardConfig): boolean {
  if (originHeader === null) return true;
  try {
    const name = new URL(originHeader).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return isLoopbackHost(name) || cfg.extraHosts.includes(name);
  } catch {
    return false; // "null" and other opaque origins
  }
}

/** Paths the guard covers. */
export const isGuardedPath = (pathname: string): boolean => pathname.startsWith("/api/") || pathname === "/api" || pathname.startsWith("/ws/");

/** Name of the cookie that carries the access token for the browser UI. */
export const TOKEN_COOKIE = "cortex_token";

/** Constant-time string equality (compares digests, so length does not leak either). */
export function tokensEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The access token a request presents: `Authorization: Bearer <token>`, the `cortex_token`
 * cookie, or (WebSocket paths only, where a browser or reporter cannot set headers) a `?token=`
 * query parameter.
 */
export function presentedToken(request: Request): string | undefined {
  const auth = request.headers.get("authorization");
  const bearer = auth !== null && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : undefined;
  if (bearer) return bearer;
  const cookie = cookieValue(request.headers.get("cookie"), TOKEN_COOKIE);
  if (cookie) return cookie;
  const url = new URL(request.url);
  return url.pathname.startsWith("/ws/") ? (url.searchParams.get("token") ?? undefined) : undefined;
}

/**
 * Why Cortex must not start, or `undefined` when it may. Off loopback every client on the
 * network reaches an API that can run code, so a non-loopback bind needs an access token.
 * Loopback needs none: the local desk stays zero-friction.
 */
export function bindRefusal(hostname: string, token: string | undefined): string | undefined {
  if (isLoopbackHost(hostname) || (token !== undefined && token !== "")) return undefined;
  return `Refusing to listen on ${hostname}: Cortex can run code and read files, and has no login. Set CORTEX_TOKEN to a secret value (clients send it as "Authorization: Bearer <token>", or open /?token=<token> once in a browser), or bind 127.0.0.1.`;
}

const forbidden = (error: string): Response =>
  new Response(JSON.stringify({ error }), { status: 403, headers: { "content-type": "application/json" } });

/**
 * With a token set, `GET /?token=<token>` (any unguarded path) stores it in an HttpOnly,
 * SameSite=Strict cookie and redirects to the same path without it, so the browser UI and its
 * WebSockets authenticate from then on.
 */
function tokenBootstrap(request: Request, cfg: RequestGuardConfig): Response | undefined {
  if (cfg.token === undefined || request.method !== "GET") return undefined;
  const url = new URL(request.url);
  const offered = url.searchParams.get("token");
  if (offered === null || !tokensEqual(offered, cfg.token)) return undefined;
  url.searchParams.delete("token");
  return new Response(null, {
    status: 302,
    headers: {
      location: `${url.pathname}${url.search}`,
      "set-cookie": `${TOKEN_COOKIE}=${encodeURIComponent(cfg.token)}; Path=/; HttpOnly; SameSite=Strict`,
    },
  });
}

/**
 * The 403 response for a request that fails the allowlist, else `undefined` (let it through).
 * Used as an Elysia `onRequest` hook, which also sees WebSocket upgrade requests.
 *
 * Checks, in order: Host and Origin (DNS rebinding); `Sec-Fetch-Site: cross-site` (a browser
 * tags a cross-site image, script or navigation GET that carries no `Origin`, so it cannot
 * reach a state-revealing or SSRF-capable endpoint); then the access token when one is set.
 */
export function guardRequest(request: Request, cfg: RequestGuardConfig): Response | undefined {
  const pathname = new URL(request.url).pathname;
  if (!isGuardedPath(pathname)) return tokenBootstrap(request, cfg);
  if (!isAllowedHost(request.headers.get("host"), cfg) || !isAllowedOrigin(request.headers.get("origin"), cfg)) {
    return forbidden("Forbidden: Host or Origin not allowed. Set CORTEX_ALLOWED_HOSTS to add a name.");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") return forbidden("Forbidden: cross-site request.");
  if (cfg.token !== undefined) {
    const offered = presentedToken(request);
    if (offered === undefined || !tokensEqual(offered, cfg.token)) {
      return new Response(JSON.stringify({ error: "Unauthorized: this Cortex needs its access token (CORTEX_TOKEN)." }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="cortex"' },
      });
    }
  }
  return undefined;
}
