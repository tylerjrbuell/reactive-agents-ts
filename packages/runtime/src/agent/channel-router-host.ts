/**
 * Starts and stops the channel router for `.withChannels({ routes })`.
 *
 * Owned by the gateway start/stop path: the router opens every adapter once, routes inbound
 * conversations to agents built by the {@link makeChannelAgentResolver} resolver, and stops with
 * the agent's gateway handle. Router state lives in memory unless the config supplies a durable
 * store; the host warns at startup when it does not.
 */
import { Effect, Exit, Scope } from "effect";
import {
  createChannelRouter,
  isChannelAdapter,
  makeRouteMeter,
  RoutingError,
} from "@reactive-agents/channels";
import type { ChannelAdapter, ChannelRouter } from "@reactive-agents/channels";
import type { AgentEvent } from "@reactive-agents/core";
import type { ChannelsConfig } from "../channels-config.js";
import { makeChannelAgentResolver } from "./channel-router-resolver.js";
import type { ChannelAgentResolverOptions } from "./channel-router-resolver.js";

/** A running router and its teardown. */
export interface ChannelRouterHost {
  readonly router: ChannelRouter;
  /** Stop adapters, release account leases, close live sessions, dispose built agents. */
  readonly stop: () => Promise<void>;
}

/** What the host needs from the gateway bootstrap. */
export interface ChannelRouterHostDeps {
  readonly config: ChannelsConfig;
  readonly eventBus?: { readonly publish: (e: AgentEvent) => Effect.Effect<void, never> };
  readonly log: (level: "info" | "warn" | "error", message: string) => void;
  /** Test seam passed to the resolver. */
  readonly build?: ChannelAgentResolverOptions["build"];
}

/**
 * Start the router for `deps.config`. Rejects with `RoutingError` / `ChannelAlreadyOwned` and
 * leaves nothing running when startup fails.
 */
export const startChannelRouterHost = async (deps: ChannelRouterHostDeps): Promise<ChannelRouterHost> => {
  const { config } = deps;
  const adapters: ChannelAdapter[] = [];
  for (const a of config.adapters) {
    if (!isChannelAdapter(a)) {
      throw new RoutingError({
        reason: "invalid_route",
        message: "withChannels({ routes }) needs canonical channel adapters; a legacy MessageChannel cannot be routed",
      });
    }
    adapters.push(a);
  }
  const resolver = makeChannelAgentResolver({
    agents: config.agents ?? {},
    ...(config.persistSessions !== undefined ? { persist: config.persistSessions } : {}),
    ...(deps.build ? { build: deps.build } : {}),
  });
  const scope = Effect.runSync(Scope.make());
  const stop = async (): Promise<void> => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await Effect.runPromise(resolver.disposeAll);
  };
  try {
    const router = await Effect.runPromise(
      Scope.extend(
        createChannelRouter({
          channels: adapters,
          routes: config.routes ?? [],
          agents: resolver,
          ...(config.store ? { store: config.store } : {}),
          ...(config.leases ? { leases: config.leases } : {}),
          ...(config.meter ? { meter: makeRouteMeter(config.meter) } : {}),
          ...(deps.eventBus ? { eventBus: deps.eventBus } : {}),
        }),
        scope,
      ),
    );
    const status = await Effect.runPromise(router.status);
    if (!status.durableStore) {
      deps.log("warn", "channel router store is in-memory: message dedupe and turn budgets reset on restart");
    }
    deps.log("info", `channel router started (${adapters.length} channel(s), ${status.routes} route(s))`);
    return { router, stop };
  } catch (error) {
    await stop();
    throw error;
  }
};
