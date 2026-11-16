import { Effect, Schedule } from "effect";
import type { Scope } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import type { ChannelAdapter, DeliveryReceipt, InboundEnvelope, OutboundMessage } from "../adapter.js";
import { isChannelError, type ChannelError } from "../errors.js";
import { RouterEngine } from "./engine.js";
import { makeFileLeases, type AccountLeases } from "./lease.js";
import type { RouteMeter } from "./meter.js";
import type { OutboxOptions } from "./outbox.js";
import { makeMemoryRouterStore } from "./store.js";
import { FollowUpTimers, makeMemoryTimers, type FollowUpLimits } from "./timers.js";
import {
  RoutingError,
  type AgentResolver,
  type ChannelAlreadyOwned,
  type RouteExplanation,
  type RouteOutcome,
  type RouterStatus,
  type RouterStore,
  type RouteSpecInput,
} from "./types.js";
import { validateRoutes, wideningChanges } from "./validate.js";

/** Options for {@link createChannelRouter}. */
export interface ChannelRouterOptions {
  /** Connections, each opened once by the router. */
  readonly channels: ReadonlyArray<ChannelAdapter>;
  /** Declared routes (builder code is the only place owners can be set). */
  readonly routes: ReadonlyArray<RouteSpecInput>;
  readonly agents: AgentResolver;
  /** Defaults to an in-memory store (dedupe and turn caps reset on restart). */
  readonly store?: RouterStore;
  /** Defaults to lock files in the OS temp dir. Pass `makeMemoryLeases()` for a single-process host. */
  readonly leases?: AccountLeases;
  /**
   * Per-route cost and message meter (`makeRouteMeter`). A turn that would exceed a route's
   * `maxCostPerDayUsd` (or the meter's message cap) is refused before the resolver runs and counted
   * as `ChannelTurnDropped` with reason `budget` (cost) or `rate` (messages). Omitted: no metering.
   */
  readonly meter?: RouteMeter;
  /**
   * Outgoing sends: retry, order and pacing. Defaults keep today's behavior (one attempt, no
   * pacing); set `maxAttempts` above 1 to retry transient failures with capped backoff. The row
   * ledger is durable when the store is (`makeSqliteRouterStore`).
   */
  readonly outbox?: OutboxOptions;
  /**
   * Follow-up timers: sessions get a `followUp` capability (see `OpenSessionRequest`), and due
   * timers wake their conversation. `true` takes the defaults. Timers are durable with a SQLite store.
   * Absent: off.
   */
  readonly followUp?: true | (FollowUpLimits & { readonly pollMs?: number });
  readonly eventBus?: { publish: (e: AgentEvent) => Effect.Effect<void, never> };
  readonly taskId?: () => string;
}

/** A running router. */
export interface ChannelRouter {
  /** Channels (state, conflict, counters), route count, unrouted and dropped counts. */
  readonly status: Effect.Effect<RouterStatus>;
  /**
   * Replace the routes. Changes that widen access (added owner, `open`, `AgentDefault`) fail with
   * `confirmation_required` unless `confirm` names each one (`owners:<routeId>`, `open:<routeId>`,
   * `agent-default:<routeId>`). No message can reach this method: it is called from builder code
   * or a gated local surface only.
   */
  readonly setRoutes: (
    routes: ReadonlyArray<RouteSpecInput>,
    options?: { readonly confirm?: ReadonlyArray<string> },
  ) => Effect.Effect<void, RoutingError>;
  /** Run an envelope through the real path (dedupe, match, access, limits, queue, a real turn) without sending. */
  readonly simulate: (env: InboundEnvelope, channelId: string) => Effect.Effect<RouteOutcome>;
  /** Pure dry run: which route, why, the sender's role and the tool surface. */
  readonly explain: (env: InboundEnvelope, channelId: string) => Effect.Effect<RouteExplanation>;
  /** Send through a channel and get its real delivery receipt. */
  readonly deliver: (
    channelId: string,
    message: OutboundMessage,
  ) => Effect.Effect<DeliveryReceipt, ChannelError>;
}

/**
 * Open every channel once and route inbound conversations to agents by rule.
 *
 * Fail-closed: a message no route claims is dropped and counted; a sender the route denies causes
 * zero resolver calls; a second owner of the same account fails with `ChannelAlreadyOwned`.
 * Closing the scope stops the adapters, releases the leases and closes live sessions.
 */
export const createChannelRouter = (
  options: ChannelRouterOptions,
): Effect.Effect<ChannelRouter, RoutingError | ChannelAlreadyOwned, Scope.Scope> =>
  Effect.gen(function* () {
    const platforms = new Map(options.channels.map((c) => [c.id, c.platform] as const));
    const platformOf = (channelId: string): string | undefined => platforms.get(channelId);
    const routes = yield* validateRoutes(options.routes, platformOf);
    for (const route of routes) {
      const id = route.match.channelId;
      if (id !== "*" && !platforms.has(id)) {
        return yield* Effect.fail(
          new RoutingError({ reason: "unknown_channel", message: `route ${route.id}: no channel ${id}`, routeId: route.id, channelId: id }),
        );
      }
    }
    const store = options.store ?? makeMemoryRouterStore();
    yield* store.setRoutes(routes);
    const leases = options.leases ?? makeFileLeases();
    let counter = 0;
    const followUp = options.followUp === true ? {} : options.followUp;
    const timers = followUp ? new FollowUpTimers(store.timers ?? makeMemoryTimers(), followUp) : undefined;
    const engine = new RouterEngine({
      store,
      agents: options.agents,
      taskId: options.taskId ?? (() => `route-${Date.now()}-${++counter}`),
      ...(options.eventBus ? { eventBus: options.eventBus } : {}),
      strict: true,
      ...(options.meter ? { meter: options.meter } : {}),
      ...(options.outbox ? { outbox: { options: options.outbox } } : {}),
      ...(timers ? { timers } : {}),
    });
    yield* Effect.addFinalizer(() => engine.shutdown());

    for (const adapter of options.channels) {
      yield* leases.acquire(adapter.id, adapter.accountFingerprint ?? `${adapter.platform}:${adapter.id}`).pipe(
        Effect.catchTag("ChannelLeaseError", (e) =>
          Effect.fail(
            new RoutingError({
              reason: "channel_start_failed",
              message: `channel ${adapter.id} failed to start (lease unavailable)`,
              channelId: adapter.id,
              cause: e,
            }),
          ),
        ),
      );
      // Registered after the lease, so (LIFO) adapters stop before the lease is released: no window
      // where a second process owns the account while this one still polls it. Idempotent.
      yield* Effect.addFinalizer(() => engine.hub.shutdown());
      yield* engine.hub.register(adapter).pipe(
        Effect.mapError(
          (cause) =>
            new RoutingError({
              reason: "channel_start_failed",
              message: `channel ${adapter.id} failed to start${isChannelError(cause) ? ` (${cause.kind})` : ""}`,
              channelId: adapter.id,
              cause,
            }),
        ),
      );
    }

    // A durable inbox: retry what a crash left behind, off the startup path (replies need the adapters, which are up now).
    yield* Effect.forkScoped(engine.replayInbox());

    // Follow-up timers: poll the store, wake each due conversation on the normal inbound path. A timer
    // that came due while the process was down fires on the first pass.
    if (timers) {
      const pass = Effect.flatMap(engine.dueTimers(), (due) =>
        Effect.forEach(due, (row) => Effect.forkScoped(engine.fireTimer(row)), { discard: true }),
      );
      yield* Effect.forkScoped(Effect.repeat(pass, Schedule.spaced(`${Math.max(10, followUp?.pollMs ?? 1000)} millis`)));
    }

    return {
      status: Effect.flatMap(store.getRoutes, (r) =>
        Effect.map(
          Effect.all([engine.inboxCounts(), engine.outboxCounts(), engine.timerCounts()]),
          ([inbox, outbox, timerCounts]) => ({
            ...engine.routerStatus(r.length),
            ...(inbox ? { inbox } : {}),
            ...(outbox ? { outbox } : {}),
            ...(timerCounts ? { timers: timerCounts } : {}),
          }),
        ),
      ),
      setRoutes: (next, opts) =>
        Effect.gen(function* () {
          const validated = yield* validateRoutes(next, platformOf);
          const needed = wideningChanges(yield* store.getRoutes, validated);
          const missing = needed.filter((n) => !(opts?.confirm ?? []).includes(n));
          if (missing.length > 0) {
            return yield* Effect.fail(
              new RoutingError({
                reason: "confirmation_required",
                message: `confirm required: ${missing.join(", ")}`,
              }),
            );
          }
          yield* store.setRoutes(validated);
        }),
      simulate: (env, channelId) => engine.simulate(env, channelId),
      explain: (env, channelId) => engine.explain(env, channelId),
      deliver: (channelId, message) => engine.send(channelId, message),
    } satisfies ChannelRouter;
  });
