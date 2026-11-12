import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Layer, Effect } from "effect";
import type { EventBus } from "@reactive-agents/core";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Durable schedule store location: `~/.reactive-agents/schedules/<agentId>/schedules.db`,
 * so cron schedules, `lastRun`/`lastResult` and restart catch-up survive restarts.
 * Test conditions (`provider: "test"` or `NODE_ENV=test`) return `undefined`, which
 * keeps the registry in memory, like the memory layer's `:memory:` isolation.
 * Returns `undefined` too if the directory cannot be created (schedules then live
 * for the process only).
 */
export function scheduleStorePath(options: RuntimeOptions): string | undefined {
  if (options.provider === "test" || process.env.NODE_ENV === "test") return undefined;
  const dir = join(homedir(), ".reactive-agents", "schedules", String(options.agentId).replace(/[^A-Za-z0-9._-]/g, "_"));
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return undefined;
  }
  return join(dir, "schedules.db");
}

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
              { path: scheduleStorePath(options) },
            );
            // schedLayer already carries the ScheduleRegistry (provideMerge), so
            // agent.schedules() and the gateway run share one durable store.
            return Layer.merge(gwLayer, schedLayer);
          }),
        );
        return gatewayLayer.pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;
  return gatewayOptLayer;
}
