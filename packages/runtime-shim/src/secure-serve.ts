import { timingSafeEqual } from "node:crypto";
import { serve } from "./serve.js";
import type { ServeOptions, ServerLike } from "./types.js";

/** Loopback hostnames that are safe to bind without an auth token. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface SecureServeOptions extends ServeOptions {
  /**
   * Bearer token required on every request (`Authorization: Bearer <token>`).
   * When set, requests without a matching token get 401. Required to bind any
   * non-loopback interface.
   */
  readonly token?: string;
  /**
   * Maximum request body size in bytes (enforced from Content-Length before the
   * handler runs). Defaults to 1 MiB. Oversized requests get 413.
   */
  readonly maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Constant-time string compare that tolerates length differences without leaking them. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against self to keep timing independent of the mismatch position.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Extract the bearer token from an Authorization header, or null. */
function bearerOf(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Secure-by-default HTTP server (F4). Wraps {@link serve} with a fail-closed
 * ingress policy:
 *
 * - **Loopback by default.** `hostname` defaults to `127.0.0.1`; a Bun server
 *   with no hostname would otherwise bind all interfaces (0.0.0.0).
 * - **No unauthenticated network exposure.** Binding a non-loopback interface
 *   without a `token` throws at construction — you cannot expose an agent
 *   server to the network without auth.
 * - **Bearer auth.** When `token` is set, every request must carry a matching
 *   `Authorization: Bearer <token>` (constant-time compare) or gets 401.
 * - **Body-size cap.** Requests whose Content-Length exceeds `maxBodyBytes`
 *   (default 1 MiB) get 413 before the wrapped handler runs — parse/agent work
 *   never starts on an oversized body.
 */
export function secureServe(options: SecureServeOptions): Promise<ServerLike> {
  const hostname = options.hostname ?? "127.0.0.1";
  const token = options.token;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (!LOOPBACK_HOSTS.has(hostname) && !token) {
    return Promise.reject(
      new Error(
        `secureServe: refusing to bind non-loopback host "${hostname}" without an auth token. ` +
          `Provide \`token\` to expose this server to the network, or bind 127.0.0.1.`,
      ),
    );
  }

  const guardedFetch = (req: Request): Response | Promise<Response> => {
    // Body-size cap — enforced before the handler runs.
    const contentLength = req.headers.get("content-length");
    if (contentLength !== null) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > maxBodyBytes) {
        return new Response(`Request body exceeds ${maxBodyBytes} bytes`, { status: 413 });
      }
    }

    // Bearer auth.
    if (token) {
      const provided = bearerOf(req);
      if (provided === null || !safeEqual(provided, token)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer" },
        });
      }
    }

    return options.fetch(req);
  };

  return serve({ port: options.port, hostname, fetch: guardedFetch });
}
