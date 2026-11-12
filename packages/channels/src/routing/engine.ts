import { Effect, Either, Exit, Scope } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { channelSenderKey } from "@reactive-agents/gateway";
import { envelopeToInboundMessage, type InboundEnvelope, type SenderGate } from "../adapter.js";
import type { ChannelError } from "../errors.js";
import type { InboundMessage } from "../types.js";
import { AdapterHub } from "./adapter-hub.js";
import {
  decideRouteAccess,
  explainRoute,
  groupAllowed,
  matchInputOf,
  matchRoute,
  orderedRoutes,
  toolExposureFor,
  type AccessVerdict,
} from "./match.js";
import {
  DEFAULT_CONVERSATION_QUEUE,
  DEFAULT_MAX_TURNS_PER_SENDER_PER_HOUR,
  RoutingError,
  type AgentResolver,
  type ApprovalPort,
  type ContentPart,
  type DropReason,
  type RouteExplanation,
  type RouteOutcome,
  type RouteRole,
  type RouteSpec,
  type RoutedReply,
  type RoutedSession,
  type RoutedTurn,
  type RouterStatus,
  type RouterStore,
} from "./types.js";

const HOUR_MS = 3_600_000;
const MAX_LIVE_SESSIONS = 500;
const BACKPRESSURE_NOTICE = "Still working on your last message.";

/** Approvals are not wired in this slice: nothing is approvable, so risky tools stay blocked. */
export const failClosedApproval: ApprovalPort = { request: () => Effect.succeed("denied") };

export interface EngineDeps {
  readonly store: RouterStore;
  readonly agents: AgentResolver;
  readonly taskId: () => string;
  readonly eventBus?: { publish: (e: AgentEvent) => Effect.Effect<void, never> };
  readonly inboundConcurrency?: number;
  /**
   * Strict routing: dedupe on platform message id, the groups rule, turn-rate caps, a bounded
   * per-conversation FIFO and the turn timeout. `ChannelService` runs the engine with
   * `strict: false`, which keeps its original pipeline behavior byte for byte.
   */
  readonly strict: boolean;
  /** Replaces the route-based access decision (`ChannelService` plugs the gateway policy in here). */
  readonly access?: (
    route: RouteSpec,
    platform: string,
    msg: InboundMessage,
    adapterId: string,
  ) => Effect.Effect<AccessVerdict>;
  /** Replaces the route-based attachment gate. */
  readonly senderGate?: (
    adapterId: string,
    sender: Parameters<SenderGate>[0],
  ) => Effect.Effect<boolean>;
  readonly conversationQueue?: number;
}

const conversationKeyOf = (adapterId: string, msg: InboundMessage): string => {
  const thread = msg.metadata["threadId"];
  return `${adapterId}:${msg.channelId}${typeof thread === "string" ? `:${thread}` : ""}`;
};

const partsOf = (msg: InboundMessage): ReadonlyArray<ContentPart> => [
  { type: "text", text: msg.content },
  ...(msg.attachments ?? []).map((attachment): ContentPart => ({ type: "attachment", attachment })),
];

/**
 * The routing pipeline: echo drop, dedupe, route match, access, groups rule, limits, a bounded
 * per-conversation queue, the {@link AgentResolver} call and the reply through the adapter.
 * `createChannelRouter` and `ChannelService` are both thin shells over it.
 */
export class RouterEngine {
  readonly hub: AdapterHub;
  private totalProcessed = 0;
  private unrouted = 0;
  private readonly dropped: Record<DropReason, number> = {
    echo: 0,
    group: 0,
    rate: 0,
    backpressure: 0,
    "disabled-channel": 0,
  };
  private readonly sessions = new Map<string, { readonly session: RoutedSession; readonly scope: Scope.CloseableScope }>();
  private readonly pending = new Map<string, number>();
  private readonly gates = new Map<string, Effect.Semaphore>();
  private readonly notified = new Set<string>();

  constructor(private readonly deps: EngineDeps) {
    this.hub = new AdapterHub({
      taskId: deps.taskId,
      ...(deps.eventBus ? { eventBus: deps.eventBus } : {}),
      ...(deps.inboundConcurrency !== undefined ? { inboundConcurrency: deps.inboundConcurrency } : {}),
      onEnvelope: (id, env) => this.handleEnvelope(id, env),
      onMessage: (id, msg) => this.handleInbound(id, msg),
      senderGate: (id, sender) => (deps.senderGate ? deps.senderGate(id, sender) : this.defaultSenderGate(id, sender)),
      onChannelFailed: (id, error) => this.onChannelFailed(id, error),
    });
  }

  // ── Events ──────────────────────────────────────────────────────────────

  /** Router events ride the core `Custom` member until core adds typed ones. Never carries text or secrets. */
  private emit(type: string, payload: Record<string, unknown>): Effect.Effect<void> {
    const bus = this.deps.eventBus;
    // Non-strict (ChannelService) keeps its original event stream: router events are strict-only.
    return bus && this.deps.strict ? bus.publish({ _tag: "Custom", type, payload }) : Effect.void;
  }

  private onChannelFailed(adapterId: string, error: ChannelError): Effect.Effect<void> {
    return error.kind === "conflict"
      ? this.emit("ChannelOwnershipChanged", { channelId: adapterId, state: "conflict" })
      : Effect.void;
  }

  // ── Gate for attachment downloads ───────────────────────────────────────

  private defaultSenderGate(adapterId: string, sender: Parameters<SenderGate>[0]): Effect.Effect<boolean> {
    const deps = this.deps;
    const platform = this.hub.platformOf(adapterId) ?? sender.platform;
    return Effect.gen(function* () {
      const routes = orderedRoutes(yield* deps.store.getRoutes).filter(
        (r) => r.match.channelId === "*" || r.match.channelId === adapterId,
      );
      for (const route of routes) {
        const verdict = yield* decideRouteAccess(route, platform, sender.userId);
        if (verdict.allowed) return true;
      }
      return false;
    });
  }

  // ── Inbound ─────────────────────────────────────────────────────────────

  /** Process one canonical envelope: echoes are dropped, the rest follow {@link handleInbound}. */
  handleEnvelope(adapterId: string, env: InboundEnvelope): Effect.Effect<void, never> {
    if (env.isEcho) {
      this.dropped.echo += 1;
      return Effect.void;
    }
    const bus = this.deps.eventBus;
    const received = bus
      ? bus.publish({
          _tag: "ChannelMessageReceived",
          sender: env.sender.userId,
          platform: env.sender.platform,
          message: env.text,
          timestamp: env.receivedAt,
          mcpServer: adapterId,
          ...(env.conversation.isGroup ? { groupId: env.conversation.channelId } : {}),
          adapterId,
          conversation: {
            channelId: env.conversation.channelId,
            ...(env.conversation.threadId !== undefined ? { threadId: env.conversation.threadId } : {}),
            isGroup: env.conversation.isGroup,
          },
        })
      : Effect.void;
    return Effect.zipRight(received, this.handleInbound(adapterId, envelopeToInboundMessage(env)));
  }

  /** Process one normalized message. A failure ends here as an `ErrorSwallowed` event, never a crash. */
  handleInbound(adapterId: string, msg: InboundMessage): Effect.Effect<void, never> {
    return this.process(adapterId, msg, false).pipe(
      Effect.asVoid,
      Effect.catchAllCause((cause) =>
        emitErrorSwallowed({ site: "channels/src/routing/engine.ts:process", tag: errorTag(cause) }),
      ),
    );
  }

  /** Same code path as a real message, but nothing is sent to the platform. */
  simulate(env: InboundEnvelope, channelId: string): Effect.Effect<RouteOutcome> {
    return this.process(channelId, envelopeToInboundMessage(env), true);
  }

  /** Dry run: route, reason, role and tool surface, with no side effect. */
  explain(env: InboundEnvelope, channelId: string): Effect.Effect<RouteExplanation> {
    const deps = this.deps;
    const platform = this.hub.platformOf(channelId) ?? env.sender.platform;
    return Effect.flatMap(deps.store.getRoutes, (routes) =>
      explainRoute(routes, channelId, platform, envelopeToInboundMessage(env)),
    );
  }

  private process(adapterId: string, msg: InboundMessage, simulated: boolean): Effect.Effect<RouteOutcome> {
    const self = this;
    const deps = this.deps;
    return Effect.gen(function* () {
      if (!simulated) self.hub.noteReceived(adapterId);
      const taskId = deps.taskId();
      if (deps.strict && !(yield* deps.store.markSeen(`${adapterId}:${msg.id}`))) {
        return { _tag: "Duplicate" } as const;
      }
      const routes = yield* deps.store.getRoutes;
      const platform = self.hub.platformOf(adapterId) ?? msg.platform;
      const input = matchInputOf(adapterId, msg);
      const route = matchRoute(routes, input);
      if (!route) {
        self.unrouted += 1;
        yield* self.emit("ChannelUnrouted", { channelId: adapterId, simulated });
        return { _tag: "Unrouted" } as const;
      }

      const verdict = yield* (deps.access
        ? deps.access(route, platform, msg, adapterId)
        : decideRouteAccess(route, platform, msg.senderId));
      if (!verdict.allowed) {
        yield* self.emit("ChannelRouteDenied", { routeId: route.id, channelId: adapterId, simulated });
        if (verdict.reply !== undefined && !simulated && self.hub.has(adapterId)) {
          yield* self.reply(adapterId, msg, verdict.reply, taskId).pipe(Effect.ignore);
        }
        return { _tag: "Denied", routeId: route.id, reason: verdict.reason } as const;
      }
      const role = verdict.role;
      yield* self.emit("ChannelRouteMatched", { routeId: route.id, channelId: adapterId, role, simulated });

      if (deps.strict) {
        if (!groupAllowed(route, input)) return yield* self.drop("group", route.id, simulated);
        if (!(yield* self.withinRate(route, platform, msg))) return yield* self.drop("rate", route.id, simulated);
      }

      const key = `${route.id}:${role}:${conversationKeyOf(adapterId, msg)}`;
      return yield* self.queued(key, deps.strict, () => self.runTurn({ adapterId, msg, route, role, key, taskId, simulated }), {
        onOverflow: () =>
          Effect.gen(function* () {
            if (!simulated && !self.notified.has(key) && self.hub.has(adapterId)) {
              self.notified.add(key);
              yield* self.reply(adapterId, msg, BACKPRESSURE_NOTICE, taskId).pipe(Effect.ignore);
            }
            return yield* self.drop("backpressure", route.id, simulated);
          }),
      });
    });
  }

  private drop(reason: DropReason, routeId: string, simulated: boolean): Effect.Effect<RouteOutcome> {
    this.dropped[reason] += 1;
    return Effect.as(this.emit("ChannelTurnDropped", { routeId, reason, simulated }), {
      _tag: "Dropped",
      reason,
      routeId,
    } as const);
  }

  private withinRate(route: RouteSpec, platform: string, msg: InboundMessage): Effect.Effect<boolean> {
    const store = this.deps.store;
    const sender = channelSenderKey(platform, msg.senderId);
    return Effect.gen(function* () {
      if (route.maxTurnsPerHour !== undefined && !(yield* store.takeTurn(`${route.id}:*`, route.maxTurnsPerHour, HOUR_MS))) {
        return false;
      }
      const perSender = route.maxTurnsPerSenderPerHour ?? DEFAULT_MAX_TURNS_PER_SENDER_PER_HOUR;
      return yield* store.takeTurn(`${route.id}:${sender}`, perSender, HOUR_MS);
    });
  }

  /** Serialize turns per key (FIFO) with a bounded backlog. Non-strict engines run unqueued. */
  private queued(
    key: string,
    enabled: boolean,
    work: () => Effect.Effect<RouteOutcome>,
    hooks: { readonly onOverflow: () => Effect.Effect<RouteOutcome> },
  ): Effect.Effect<RouteOutcome> {
    if (!enabled) return work();
    const self = this;
    const max = this.deps.conversationQueue ?? DEFAULT_CONVERSATION_QUEUE;
    return Effect.suspend(() => {
      const inFlight = self.pending.get(key) ?? 0;
      if (inFlight >= max) return hooks.onOverflow();
      self.pending.set(key, inFlight + 1);
      return Effect.gen(function* () {
        const gate = self.gates.get(key) ?? (yield* Effect.makeSemaphore(1));
        self.gates.set(key, gate);
        return yield* gate.withPermits(1)(Effect.suspend(work));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            const left = (self.pending.get(key) ?? 1) - 1;
            if (left <= 0) {
              self.pending.delete(key);
              self.gates.delete(key);
              self.notified.delete(key);
            } else {
              self.pending.set(key, left);
            }
          }),
        ),
      );
    });
  }

  // ── The turn ────────────────────────────────────────────────────────────

  private session(
    key: string,
    route: RouteSpec,
    role: RouteRole,
    adapterId: string,
    msg: InboundMessage,
  ): Effect.Effect<{ readonly session: RoutedSession; readonly scope: Scope.CloseableScope }, RoutingError> {
    const self = this;
    return Effect.gen(function* () {
      const stateless = route.session === "stateless";
      const live = stateless ? undefined : self.sessions.get(key);
      if (live) {
        self.sessions.delete(key);
        self.sessions.set(key, live); // touch: most recently used
        return live;
      }
      const scope = yield* Scope.make();
      const opened = yield* Scope.extend(
        self.deps.agents.open({
          routeId: route.id,
          role,
          target: route.target,
          toolExposure: toolExposureFor(route, role),
          conversationKey: conversationKeyOf(adapterId, msg),
          stateless,
        }),
        scope,
      ).pipe(Effect.tapError(() => Scope.close(scope, Exit.void)));
      const entry = { session: opened, scope };
      if (!stateless) {
        self.sessions.set(key, entry);
        while (self.sessions.size > MAX_LIVE_SESSIONS) {
          const oldest = self.sessions.keys().next().value;
          const evicted = oldest === undefined ? undefined : self.sessions.get(oldest);
          if (oldest === undefined) break;
          self.sessions.delete(oldest);
          if (evicted) yield* Scope.close(evicted.scope, Exit.void);
        }
      }
      return entry;
    });
  }

  private runTurn(args: {
    readonly adapterId: string;
    readonly msg: InboundMessage;
    readonly route: RouteSpec;
    readonly role: RouteRole;
    readonly key: string;
    readonly taskId: string;
    readonly simulated: boolean;
  }): Effect.Effect<RouteOutcome> {
    const self = this;
    const { adapterId, msg, route, role, key, taskId, simulated } = args;
    return Effect.gen(function* () {
      yield* self.emit("ChannelTurnStarted", { routeId: route.id, role, simulated });
      const turn: RoutedTurn = {
        text: msg.content,
        parts: partsOf(msg),
        sender: {
          platform: msg.platform,
          userId: msg.senderId,
          ...(msg.senderName !== undefined ? { displayName: msg.senderName } : {}),
        },
        approval: failClosedApproval,
        message: msg,
        taskId,
      };
      const attempt = yield* Effect.either(
        Effect.gen(function* () {
          const entry = yield* self.session(key, route, role, adapterId, msg);
          const send = entry.session.send(turn);
          const bounded = self.deps.strict
            ? send.pipe(
                Effect.timeoutFail({
                  duration: route.turnTimeoutMs,
                  onTimeout: () =>
                    new RoutingError({ reason: "turn_timeout", message: `route ${route.id}: turn timed out`, routeId: route.id }),
                }),
              )
            : send;
          return yield* route.session === "stateless"
            ? bounded.pipe(Effect.ensuring(Scope.close(entry.scope, Exit.void)))
            : bounded;
        }),
      );
      self.totalProcessed += 1;
      if (Either.isLeft(attempt)) {
        yield* self.emit("ChannelTurnCompleted", { routeId: route.id, role, ok: false, reason: attempt.left.reason, simulated });
        return { _tag: "Failed", routeId: route.id, role, error: attempt.left } as const;
      }
      const reply: RoutedReply = attempt.right;
      yield* self.emit("ChannelTurnCompleted", {
        routeId: route.id,
        role,
        ok: true,
        simulated,
        ...(reply.tokens !== undefined ? { tokens: reply.tokens } : {}),
        ...(reply.costUsd !== undefined ? { costUsd: reply.costUsd } : {}),
        ...(reply.runId !== undefined ? { runId: reply.runId } : {}),
      });
      if (!reply.text || simulated || !self.hub.has(adapterId)) {
        return { _tag: "Answered", routeId: route.id, role, reply } as const;
      }
      const sent = yield* Effect.either(self.reply(adapterId, msg, reply.text, taskId));
      return Either.isRight(sent)
        ? ({ _tag: "Answered", routeId: route.id, role, reply, receipt: sent.right } as const)
        : ({ _tag: "Answered", routeId: route.id, role, reply, deliveryError: sent.left } as const);
    });
  }

  /** Reply through the same adapter. A failed delivery is already counted and published by `deliver`. */
  private reply(adapterId: string, msg: InboundMessage, text: string, taskId: string) {
    return this.hub.deliver(
      adapterId,
      {
        conversation: {
          channelId: msg.channelId,
          ...(typeof msg.metadata["threadId"] === "string" ? { threadId: msg.metadata["threadId"] } : {}),
        },
        text,
        ...(msg.replyTo !== undefined ? { replyTo: msg.replyTo } : {}),
      },
      taskId,
    );
  }

  // ── Status and shutdown ─────────────────────────────────────────────────

  get processed(): number {
    return this.totalProcessed;
  }

  /** Live (cached) route sessions. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  routerStatus(routeCount: number): RouterStatus {
    return {
      channels: this.hub.info().map((a) => ({
        id: a.id,
        platform: a.platform,
        connected: a.connected,
        conflict: this.hub.conflicted(a.id),
        messagesReceived: a.messagesReceived,
        messagesSent: a.messagesSent,
        deliveryFailures: a.deliveryFailures,
      })),
      routes: routeCount,
      unrouted: this.unrouted,
      dropped: { ...this.dropped },
      activeSessions: this.sessions.size,
      durableStore: this.deps.store.durable,
    };
  }

  /** Stop the adapters and close every live route session. Idempotent. */
  shutdown(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.hub.shutdown();
      const live = [...self.sessions.values()];
      self.sessions.clear();
      for (const entry of live) yield* Scope.close(entry.scope, Exit.void);
    });
  }
}
