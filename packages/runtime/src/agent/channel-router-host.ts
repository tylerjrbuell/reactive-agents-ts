/**
 * Starts and stops the channel router for `.withChannels({ routes })`.
 *
 * Owned by the gateway start/stop path: the router opens every adapter once, routes inbound
 * conversations to agents built by the {@link makeChannelAgentResolver} resolver, and stops with
 * the agent's gateway handle. Router state lives in memory unless the config supplies a durable
 * store; the host warns at startup when it does not.
 */
import { Effect } from "effect";
import { runTyped, startScoped, type Started } from "./start-scoped.js";
import {
  createChannelRouter,
  isChannelAdapter,
  makeRouteMeter,
  makeSqliteRouterStore,
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
  // Per-turn folding and the follow-up tool bind to one conversation, so those agents are per conversation.
  const perConversation = config.followUp !== undefined || (config.routes ?? []).some((r) => r.midRun === "fold" || r.midRun === "interrupt");
  const resolver = makeChannelAgentResolver({
    agents: config.agents ?? {},
    ...(config.persistSessions !== undefined ? { persist: config.persistSessions } : {}),
    ...(deps.build ? { build: deps.build } : {}),
    ...(perConversation ? { perConversation: true } : {}),
  });
  if (config.inbox && config.store) {
    deps.log("warn", "withChannels: both `store` and `inbox` set; the explicit `store` wins and `inbox` is ignored");
  }
  const routerEffect = Effect.gen(function* () {
    const store = config.store ?? (config.inbox ? yield* makeSqliteRouterStore(config.inbox) : undefined);
    return yield* createChannelRouter({
      channels: adapters,
      routes: config.routes ?? [],
      agents: resolver,
      ...(store ? { store } : {}),
      ...(config.leases ? { leases: config.leases } : {}),
      ...(config.meter ? { meter: makeRouteMeter(config.meter) } : {}),
      ...(config.outbox ? { outbox: config.outbox } : {}),
      ...(config.followUp !== undefined ? { followUp: config.followUp } : {}),
      ...(deps.eventBus ? { eventBus: deps.eventBus } : {}),
    });
  });
  // disposeAll always runs, even when closing the router scope fails.
  const disposeAfter = async (close: () => Promise<void>): Promise<void> => {
    try {
      await close();
    } finally {
      await Effect.runPromise(resolver.disposeAll);
    }
  };
  let started: Started<ChannelRouter>;
  try {
    started = await startScoped(routerEffect);
  } catch (error) {
    // startScoped already closed the router scope; dispose any agents built before the failure.
    await Effect.runPromise(resolver.disposeAll);
    return Promise.reject(error);
  }
  const stop = (): Promise<void> => disposeAfter(started.stop);
  const router = started.value;
  try {
    const status = await runTyped(router.status);
    if (!status.durableStore) {
      deps.log("warn", "channel router store is in-memory: message dedupe and turn budgets reset on restart");
    }
    deps.log("info", `channel router started (${adapters.length} channel(s), ${status.routes} route(s))`);
    return { router, stop };
  } catch (error) {
    await stop();
    return Promise.reject(error);
  }
};
