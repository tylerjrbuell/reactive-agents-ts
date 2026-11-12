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
import { isLoopbackHost } from "./listen-host.js";

/** What the guard compares against. */
export interface RequestGuardConfig {
  /** Extra lower-case host names (no port) the operator expects (public URL, reverse proxy). */
  readonly extraHosts: readonly string[];
}

/** Host names (lower-case, no port or brackets) from `CORTEX_URL` and `CORTEX_ALLOWED_HOSTS`. */
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
  return { extraHosts: extra };
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

/**
 * The 403 response for a request that fails the allowlist, else `undefined` (let it through).
 * Used as an Elysia `onRequest` hook, which also sees WebSocket upgrade requests.
 */
export function guardRequest(request: Request, cfg: RequestGuardConfig): Response | undefined {
  const pathname = new URL(request.url).pathname;
  if (!isGuardedPath(pathname)) return undefined;
  if (isAllowedHost(request.headers.get("host"), cfg) && isAllowedOrigin(request.headers.get("origin"), cfg)) return undefined;
  return new Response(JSON.stringify({ error: "Forbidden: Host or Origin not allowed. Set CORTEX_ALLOWED_HOSTS to add a name." }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
