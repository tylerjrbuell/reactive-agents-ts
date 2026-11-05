import { Layer, Effect } from "effect";
import type { EventBus } from "@reactive-agents/core";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Gateway — compose GatewayService + SchedulerService when enabled.
 * Extracted verbatim from `createRuntime` (GH #267).
 */
export function buildGatewayLayer(
  options: RuntimeOptions,
  eventBusLayer: Layer.Layer<EventBus>,
) {
  const gatewayOptLayer = options.enableGateway
    ? (() => {
        const gatewayLayer = Layer.unwrapEffect(
          Effect.gen(function* () {
            const gw = yield* Effect.promise(
              () => import("@reactive-agents/gateway"),
            );

            // Resolve EventBus from context for observability (optional).
            // Use Effect.catchAll — yield* with a missing service produces a fiber failure,
            // not a JS exception, so try/catch won't catch it.
            const core = yield* Effect.promise(
              () => import("@reactive-agents/core"),
            );
            type BusLike = { publish: (e: unknown) => Effect.Effect<void, never> };
            const bus: BusLike | undefined = yield* Effect.gen(function* () {
              const eb = yield* core.EventBus;
              return { publish: (e: unknown) => eb.publish(e as Parameters<typeof eb.publish>[0]) } as BusLike;
            }).pipe(
              Effect.catchAll(() =>
                Effect.succeed(undefined as BusLike | undefined),
              ),
            );

            const gwLayer = gw.GatewayServiceLive(
              (options.gatewayOptions ?? {}) as Parameters<typeof gw.GatewayServiceLive>[0],
              bus,
            );
            const schedLayer = gw.SchedulerServiceLive(
              {
                agentId: options.agentId,
                timezone: options.gatewayOptions?.timezone,
                heartbeat: options.gatewayOptions?.heartbeat,
                crons: options.gatewayOptions?.crons,
              } as Parameters<typeof gw.SchedulerServiceLive>[0],
              bus,
            );
            return Layer.merge(gwLayer, schedLayer);
          }),
        );
        return gatewayLayer.pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;
  return gatewayOptLayer;
}
