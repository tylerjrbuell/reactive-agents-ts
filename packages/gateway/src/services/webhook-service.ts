import { Effect, Context, Layer, Ref } from "effect";
import { WebhookValidationError } from "../errors.js";
import type { GatewayEvent, WebhookConfig } from "../types.js";
import type { WebhookAdapter, WebhookRequest } from "../adapters/webhook-adapter.js";
import { createGitHubAdapter } from "../adapters/github-adapter.js";
import { createGenericAdapter } from "../adapters/generic-adapter.js";

// ─── Route Entry ─────────────────────────────────────────────────────────────

interface RouteEntry {
  readonly adapter: WebhookAdapter;
  readonly secret?: string;
  /** When true (default), a route with no secret is refused (fail-closed, F11). */
  readonly requireSignature: boolean;
}

export interface RegisterAdapterOptions {
  /**
   * Require a verified signature. Defaults to true: a route registered without a
   * secret is refused, so an unauthenticated webhook cannot impersonate a sender.
   * Set false to explicitly allow a secretless route.
   */
  readonly requireSignature?: boolean;
}

// ─── Built-in Adapter Registry ───────────────────────────────────────────────

const builtinAdapters: Record<string, () => WebhookAdapter> = {
  github: createGitHubAdapter,
  generic: createGenericAdapter,
};

// ─── Service Tag ─────────────────────────────────────────────────────────────

export class WebhookService extends Context.Tag("WebhookService")<
  WebhookService,
  {
    readonly handleRequest: (
      path: string,
      req: WebhookRequest,
    ) => Effect.Effect<GatewayEvent, WebhookValidationError>;
    readonly registerAdapter: (
      path: string,
      adapter: WebhookAdapter,
      secret?: string,
      options?: RegisterAdapterOptions,
    ) => Effect.Effect<void, never>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const WebhookServiceLive = (configs?: readonly WebhookConfig[]) =>
  Layer.effect(
    WebhookService,
    Effect.gen(function* () {
      const routesRef = yield* Ref.make<Record<string, RouteEntry>>({});

      // Pre-register routes from config
      if (configs) {
        const initial: Record<string, RouteEntry> = {};
        for (const cfg of configs) {
          const factory = builtinAdapters[cfg.adapter];
          if (factory) {
            initial[cfg.path] = {
              adapter: factory(),
              secret: cfg.secret,
              requireSignature: cfg.requireSignature ?? true,
            };
          }
        }
        yield* Ref.set(routesRef, initial);
      }

      return {
        handleRequest: (path: string, req: WebhookRequest) =>
          Effect.gen(function* () {
            const routes = yield* Ref.get(routesRef);
            const route = routes[path];

            if (!route) {
              return yield* Effect.fail(
                new WebhookValidationError({
                  message: `No adapter registered for path: ${path}`,
                  source: "unknown",
                  statusCode: 404,
                }),
              );
            }

            // Fail-closed (F11): a route that requires a signature but has no
            // secret cannot be authenticated — refuse rather than accept any POST.
            if (!route.secret && route.requireSignature) {
              return yield* Effect.fail(
                new WebhookValidationError({
                  message: `Webhook route "${path}" has no secret configured and requireSignature is on — refusing unauthenticated request`,
                  source: route.adapter.source,
                  statusCode: 401,
                }),
              );
            }

            // Validate signature if secret is configured
            if (route.secret) {
              const valid = yield* route.adapter.validateSignature(
                req,
                route.secret,
              );
              if (!valid) {
                return yield* Effect.fail(
                  new WebhookValidationError({
                    message: `Invalid webhook signature for path: ${path}`,
                    source: route.adapter.source,
                    statusCode: 401,
                  }),
                );
              }
            }

            // Transform payload to GatewayEvent
            const event = yield* route.adapter.transform(req).pipe(
              Effect.mapError(
                (transformErr) =>
                  new WebhookValidationError({
                    message: transformErr.message,
                    source: transformErr.source,
                    statusCode: 400,
                  }),
              ),
            );

            return event;
          }),

        registerAdapter: (
          path: string,
          adapter: WebhookAdapter,
          secret?: string,
          options?: RegisterAdapterOptions,
        ) =>
          Ref.update(routesRef, (routes) => ({
            ...routes,
            [path]: {
              adapter,
              secret,
              requireSignature: options?.requireSignature ?? true,
            },
          })),
      };
    }),
  );
