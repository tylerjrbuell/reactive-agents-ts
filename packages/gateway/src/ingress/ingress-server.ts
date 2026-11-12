import { Effect, Runtime, type Scope } from "effect";
import { serve } from "@reactive-agents/runtime-shim";
import { IngressStartError } from "../errors.js";
import { WebhookService, WebhookServiceLive } from "../services/webhook-service.js";
import type { EventBusLike, GatewayConfig, GatewayEvent } from "../types.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_BODY_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_IN_FLIGHT = 64;
const LOOPBACK = "127.0.0.1";

/** What an ingress channel route needs from a channel adapter (`TelegramChannelAdapter.handleWebhook`). */
export interface IngressChannelRoute {
  /** URL path the platform posts to, e.g. `/channels/telegram`. */
  readonly path: string;
  /** Adapter id, used for logs only. */
  readonly id: string;
  /**
   * Verify (fail closed) and enqueue the request. The error needs only a `kind`, the shape of the
   * channels package's `ChannelError`; its message is never sent to the caller.
   */
  readonly handle: (req: {
    readonly body: string;
    readonly headers: Record<string, string>;
  }) => Effect.Effect<void, { readonly kind: string; readonly message: string }>;
}

export interface IngressOptions {
  /** Default `127.0.0.1`. Binding another interface is an explicit decision: every route still verifies its own secret. */
  readonly hostname?: string;
  /** Default 0 (ephemeral). `GatewayConfig.port` for the real gateway. */
  readonly port?: number;
  /** Largest accepted request body. Default 1 MiB. Larger bodies get 413 and are never parsed. */
  readonly maxBodyBytes?: number;
  /** Longest a sender may take to deliver the body. Default 10 s. Slower senders get 408. */
  readonly bodyTimeoutMs?: number;
  /** Most requests handled at once. Default 64. Beyond it the server answers 503 immediately. */
  readonly maxInFlight?: number;
  readonly channelRoutes?: readonly IngressChannelRoute[];
  /**
   * Receives each verified webhook as a {@link GatewayEvent}. Must enqueue, not run the agent:
   * the HTTP response waits for it. Failures turn into a 500 so the sender retries.
   */
  readonly onEvent: (event: GatewayEvent) => Effect.Effect<void>;
  readonly bus?: EventBusLike;
}

export interface IngressServer {
  readonly port: number;
  readonly hostname: string;
  readonly url: string;
  readonly stop: () => Effect.Effect<void>;
}

const REASONS: Readonly<Record<number, string>> = {
  400: "bad request",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  405: "method not allowed",
  408: "request timeout",
  413: "payload too large",
  429: "rate limited",
  500: "internal error",
  502: "bad gateway",
  503: "busy",
};

const reply = (status: number): Response =>
  new Response(JSON.stringify({ ok: status < 300, ...(status >= 300 ? { error: REASONS[status] ?? "error" } : {}) }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** ChannelErrorKind -> HTTP status. Unknown kinds are a server fault. */
const channelStatus = (kind: string): number => {
  switch (kind) {
    case "auth":
    case "forbidden":
      return 401;
    case "not_found":
      return 404;
    case "unsupported":
      return 400;
    case "too_large":
      return 413;
    case "rate_limited":
      return 429;
    case "network":
      return 502;
    default:
      return 500;
  }
};

/** Outcome of {@link readCapped}: the body, or why it was refused. */
type BodyRead =
  | { readonly kind: "ok"; readonly body: string }
  | { readonly kind: "too_large" }
  | { readonly kind: "timeout" };

/**
 * Read at most `max` bytes within `timeoutMs`. A larger body or a slow sender (slowloris) is
 * refused and the stream cancelled, never buffered.
 */
const readCapped = async (req: Request, max: number, timeoutMs: number): Promise<BodyRead> => {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { kind: "too_large" };
  if (!req.body) return { kind: "ok", body: "" };
  const reader = req.body.getReader();
  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = new Promise<"timeout">((resolve) => {
    signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await Promise.race([reader.read(), aborted]);
    if (next === "timeout") {
      await reader.cancel().catch(() => undefined);
      return { kind: "timeout" };
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too_large" };
    }
    chunks.push(next.value);
  }
  return { kind: "ok", body: Buffer.concat(chunks).toString("utf8") };
};

const headersOf = (req: Request): Record<string, string> => {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
};

/**
 * Mount the gateway's webhook ingress: the {@link WebhookService} routes (GitHub, generic) plus
 * channel webhook routes (Telegram), on one small HTTP server bound to loopback by default.
 *
 * Fail-closed at every layer: POST only, body capped before parsing, unknown paths 404, and each
 * route verifies its own secret (WebhookService refuses secretless routes; channel adapters
 * refuse unconfigured webhooks). Error bodies are generic: adapter messages never leave the
 * process. The server stops when the surrounding scope closes.
 */
export const startIngress = (
  options: IngressOptions,
): Effect.Effect<IngressServer, IngressStartError, WebhookService | Scope.Scope> =>
  Effect.gen(function* () {
    const webhooks = yield* WebhookService;
    const runtime = yield* Effect.runtime<never>();
    const run = Runtime.runPromise(runtime);
    const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const routes = new Map((options.channelRoutes ?? []).map((r) => [r.path, r] as const));

    const bodyTimeoutMs = options.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
    const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    let inFlight = 0;

    const handle = async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return reply(405);
      // Shed load before reading anything: slow or numerous connections cannot pile up unbounded.
      if (inFlight >= maxInFlight) return reply(503);
      inFlight += 1;
      try {
        return await handleAdmitted(req, path);
      } finally {
        inFlight -= 1;
      }
    };

    const handleAdmitted = async (req: Request, path: string): Promise<Response> => {
      const read = await readCapped(req, maxBody, bodyTimeoutMs);
      if (read.kind === "too_large") return reply(413);
      if (read.kind === "timeout") return reply(408);
      const request = { body: read.body, headers: headersOf(req) };

      const channel = routes.get(path);
      if (channel) {
        return run(
          channel.handle(request).pipe(
            Effect.as(reply(200)),
            Effect.catchAll((e) =>
              Effect.logWarning(`ingress: channel ${channel.id} rejected request (${e.kind})`).pipe(
                Effect.as(reply(channelStatus(e.kind))),
              ),
            ),
          ),
        );
      }

      return run(
        webhooks.handleRequest(path, request).pipe(
          Effect.matchEffect({
            onFailure: (e) =>
              Effect.logWarning(`ingress: webhook ${path} rejected (${e.statusCode ?? 400})`).pipe(
                Effect.as(reply(e.statusCode ?? 400)),
              ),
            onSuccess: (event) => options.onEvent(event).pipe(Effect.as(reply(202))),
          }),
        ),
      ).catch(() => reply(500));
    };

    const server = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          serve({
            hostname: options.hostname ?? LOOPBACK,
            port: options.port ?? 0,
            fetch: (req) => handle(req).catch(() => reply(500)),
          }),
        catch: (cause) => new IngressStartError({ message: "ingress: could not start the HTTP server", cause }),
      }),
      (s) => Effect.sync(() => s.stop(true)),
    );

    return {
      port: server.port,
      hostname: server.hostname,
      url: `http://${server.hostname}:${server.port}`,
      stop: () => Effect.sync(() => server.stop(true)),
    };
  });

/**
 * Start ingress from `GatewayConfig`: `config.port` is the listen port and `config.webhooks` the
 * WebhookService routes. Returns undefined when no webhooks and no channel routes are configured
 * (nothing to serve, so no socket is opened).
 */
export const startGatewayIngress = (
  config: Pick<GatewayConfig, "port"> & Partial<Pick<GatewayConfig, "webhooks">>,
  options: Omit<IngressOptions, "port">,
): Effect.Effect<IngressServer | undefined, IngressStartError, Scope.Scope> => {
  const hasRoutes = (config.webhooks?.length ?? 0) > 0 || (options.channelRoutes?.length ?? 0) > 0;
  if (!hasRoutes) return Effect.succeed(undefined);
  return startIngress({ ...options, port: config.port }).pipe(
    Effect.provide(WebhookServiceLive(config.webhooks)),
  );
};
