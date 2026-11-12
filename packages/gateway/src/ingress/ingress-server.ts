import { Effect, Runtime, type Scope } from "effect";
import { serve } from "@reactive-agents/runtime-shim";
import { IngressStartError } from "../errors.js";
import { WebhookService, WebhookServiceLive } from "../services/webhook-service.js";
import type { EventBusLike, GatewayConfig, GatewayEvent } from "../types.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
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
  413: "payload too large",
  429: "rate limited",
  500: "internal error",
  502: "bad gateway",
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

/** Read at most `max` bytes; null when the body is larger (the stream is cancelled, not buffered). */
const readCapped = async (req: Request, max: number): Promise<string | null> => {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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

    const handle = async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return reply(405);
      const body = await readCapped(req, maxBody);
      if (body === null) return reply(413);
      const request = { body, headers: headersOf(req) };

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
