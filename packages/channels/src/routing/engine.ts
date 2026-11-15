import { Clock, Deferred, Effect, Either, Exit, Scope } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { channelSenderKey } from "@reactive-agents/gateway";
import { envelopeToInboundMessage, type InboundEnvelope, type SenderGate } from "../adapter.js";
import type { ChannelError } from "../errors.js";
import type { InboundMessage } from "../types.js";
import { AdapterHub } from "./adapter-hub.js";
import { chooseAckText, pickAckText, resolveAck, withTurnAck, type AckPortResult } from "./ack.js";
import type { RouteMeter } from "./meter.js";
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
const RESET_CONFIRMATION = "Started a new conversation.";
const RESET_FAILED_NOTICE = "Could not start a new conversation.";
const TURN_FAILED_NOTICE = "Something went wrong and I could not finish that. Send it again, or ask me to continue.";

/** Fixed sender-facing text for a failed turn. Never carries the error message. */
const failureNoticeText = (error: RoutingError, route: RouteSpec): string =>
  error.reason === "turn_timeout"
    ? `That took longer than the ${Math.max(1, Math.round(route.turnTimeoutMs / 1000))}-second turn limit, so I stopped. Send it again, or ask me to continue.`
    : TURN_FAILED_NOTICE;

/** True when the whole message is one of the route's reset commands (`/new`, `/New@my_bot`). */
const isResetCommand = (route: RouteSpec, text: string): boolean => {
  if (route.resetCommands.length === 0) return false;
  const token = text.trim();
  if (token === "" || /\s/.test(token)) return false;
  const name = token.toLowerCase().split("@")[0] ?? "";
  return route.resetCommands.some((c) => c.toLowerCase() === name);
};

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
  /** Optional per-route cost and message meter; a refused reservation drops the turn before the resolver is called. */
  readonly meter?: RouteMeter;
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
    budget: 0,
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

  /** Publish a typed router event. Strict-only: non-strict (ChannelService) keeps its original event stream. Never carries text or secrets. */
  private emit(event: AgentEvent): Effect.Effect<void> {
    const bus = this.deps.eventBus;
    return bus && this.deps.strict ? bus.publish(event) : Effect.void;
  }

  private onChannelFailed(adapterId: string, error: ChannelError): Effect.Effect<void> {
    return error.kind === "conflict"
      ? this.emit({ _tag: "ChannelOwnershipChanged", channelId: adapterId, state: "conflict" })
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
        yield* self.emit({ _tag: "ChannelUnrouted", channelId: adapterId, simulated });
        return { _tag: "Unrouted" } as const;
      }

      const verdict = yield* (deps.access
        ? deps.access(route, platform, msg, adapterId)
        : decideRouteAccess(route, platform, msg.senderId));
      if (!verdict.allowed) {
        yield* self.emit({ _tag: "ChannelRouteDenied", routeId: route.id, channelId: adapterId, simulated });
        if (verdict.reply !== undefined && !simulated && self.hub.has(adapterId)) {
          yield* self.reply(adapterId, msg, verdict.reply, taskId).pipe(Effect.ignore);
        }
        return { _tag: "Denied", routeId: route.id, reason: verdict.reason } as const;
      }
      const role = verdict.role;
      yield* self.emit({ _tag: "ChannelRouteMatched", routeId: route.id, channelId: adapterId, role, simulated });

      if (deps.strict) {
        if (!groupAllowed(route, input)) return yield* self.drop("group", route.id, simulated);
      }

      const key = `${route.id}:${role}:${conversationKeyOf(adapterId, msg)}`;
      // Owner reset command: handled here, never forwarded to the agent, exempt from the turn-rate cap.
      if (deps.strict && role === "owner" && isResetCommand(route, msg.content)) {
        return yield* self.queued(key, true, () => self.resetConversation({ adapterId, msg, route, role, key, taskId, simulated }), {
          onOverflow: () => self.drop("backpressure", route.id, simulated),
        });
      }
      if (deps.strict && !(yield* self.withinRate(route, platform, msg))) return yield* self.drop("rate", route.id, simulated);
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
    return Effect.as(this.emit({ _tag: "ChannelTurnDropped", routeId, reason, simulated }), {
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

  /**
   * Owner reset command: let the resolver clear its history (`reset`), close the live session and drop
   * it from the cache, so the next message opens a new one. The command never reaches the agent.
   * Runs inside the conversation queue, so it waits for any turn in flight.
   */
  private resetConversation(args: {
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
      const cleared: Either.Either<void, RoutingError> =
        simulated || route.session === "stateless"
          ? Either.right(undefined)
          : yield* Effect.either(
              Effect.gen(function* () {
                const entry = yield* self.session(key, route, role, adapterId, msg);
                if (entry.session.reset) yield* entry.session.reset;
                self.sessions.delete(key);
                yield* Scope.close(entry.scope, Exit.void);
              }),
            );
      const ok = Either.isRight(cleared);
      yield* self.emit({
        _tag: "ChannelConversationReset",
        routeId: route.id,
        role,
        ok,
        ...(Either.isLeft(cleared) ? { reason: cleared.left.reason } : {}),
        simulated,
      });
      const reply: RoutedReply = { text: ok ? RESET_CONFIRMATION : RESET_FAILED_NOTICE };
      if (simulated || !self.hub.has(adapterId)) return { _tag: "Answered", routeId: route.id, role, reply } as const;
      const sent = yield* Effect.either(self.reply(adapterId, msg, reply.text, taskId));
      return Either.isRight(sent)
        ? ({ _tag: "Answered", routeId: route.id, role, reply, receipt: sent.right } as const)
        : ({ _tag: "Answered", routeId: route.id, role, reply, deliveryError: sent.left } as const);
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
    const meter = self.deps.meter;
    return Effect.gen(function* () {
      const reservation = meter ? yield* meter.reserve(route) : undefined;
      if (reservation && !reservation.ok) {
        return yield* self.drop(reservation.reason === "cost" ? "budget" : "rate", route.id, simulated);
      }
      const reservationId = reservation?.ok ? reservation.id : undefined;
      // Idempotent: a settled reservation is already gone, so this only frees a failed or interrupted turn.
      const releaseHeld =
        meter && reservationId !== undefined ? meter.release(reservationId) : Effect.void;
      yield* self.emit({ _tag: "ChannelTurnStarted", routeId: route.id, role, simulated });
      const baseTurn: RoutedTurn = {
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
        self.acknowledged(route, role, adapterId, msg, taskId, simulated, baseTurn, (turn, noteSession) => Effect.gen(function* () {
          const entry = yield* self.session(key, route, role, adapterId, msg);
          noteSession(entry.session);
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
        })),
      ).pipe(
        Effect.tap((result) =>
          meter && reservationId !== undefined && Either.isRight(result)
            ? meter.settle(reservationId, result.right.costUsd ?? 0)
            : Effect.void,
        ),
        Effect.ensuring(releaseHeld),
      );
      self.totalProcessed += 1;
      if (Either.isLeft(attempt)) {
        yield* self.emit({ _tag: "ChannelTurnCompleted", routeId: route.id, role, ok: false, reason: attempt.left.reason, simulated });
        if (self.deps.strict && route.failureNotice && !simulated && self.hub.has(adapterId)) {
          // Best effort: `deliver` already counts and publishes a failed send; the turn outcome stays Failed.
          yield* self.reply(adapterId, msg, failureNoticeText(attempt.left, route), taskId).pipe(Effect.ignore);
        }
        return { _tag: "Failed", routeId: route.id, role, error: attempt.left } as const;
      }
      const reply: RoutedReply = attempt.right;
      yield* self.emit({
        _tag: "ChannelTurnCompleted",
        routeId: route.id,
        role,
        ok: true,
        simulated,
        ...(reply.tokens !== undefined ? { tokens: reply.tokens } : {}),
        ...(reply.costUsd !== undefined ? { costUsd: reply.costUsd } : {}),
        ...(reply.runId !== undefined ? { runId: reply.runId } : {}),
        ...(reply.agentId !== undefined ? { agentId: reply.agentId } : {}),
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

  /**
   * Wrap a running turn with the route's acknowledgement (typing pulse, then one message after
   * `ack.afterMs`). Off for simulations, `ack: false`/absent, and unregistered adapters. The ack goes
   * straight to the adapter, never through the session, so it is not agent history; a failed ack
   * is swallowed (`ErrorSwallowed`) and never fails the turn.
   */
  private acknowledged<A, E>(
    route: RouteSpec,
    role: RouteRole,
    adapterId: string,
    msg: InboundMessage,
    taskId: string,
    simulated: boolean,
    baseTurn: RoutedTurn,
    run: (turn: RoutedTurn, noteSession: (session: RoutedSession) => void) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    const ack = resolveAck(route.ack);
    if (!ack || simulated || !this.hub.has(adapterId)) return run(baseTurn, () => undefined);
    // Per-turn closure state: the latest narration, the live session, and whether the ack already went out.
    let narration: string | undefined;
    let sealed = false;
    const turn: RoutedTurn =
      ack.source === "model"
        ? { ...baseTurn, onProgress: (text) => { if (!sealed && typeof text === "string") narration = text; } }
        : baseTurn;
    const conversation = {
      channelId: msg.channelId,
      ...(typeof msg.metadata["threadId"] === "string" ? { threadId: msg.metadata["threadId"] } : {}),
    };
    const pulse = this.hub.typingPulse(adapterId, conversation);
    // Model-ack prefetch: the port call starts with the turn (once the session is known), so a cold
    // model gets afterMs + modelTimeoutMs of wall time. The result waits in `prefetched`.
    const sessionReady = Effect.runSync(Deferred.make<RoutedSession>());
    const prefetched = Effect.runSync(Deferred.make<AckPortResult>());
    let noPort = false;
    let portStartedAt: number | undefined;
    let portFinishedAt: number | undefined;
    const background: Effect.Effect<void> | undefined =
      ack.source === "model"
        ? Effect.gen(function* () {
            const s = yield* Deferred.await(sessionReady);
            const port = s.acknowledge?.(turn);
            if (port === undefined) { noPort = true; return; }
            portStartedAt = yield* Clock.currentTimeMillis;
            const result = yield* port.pipe(
              Effect.catchAllCause(() => Effect.succeed<AckPortResult>({ text: "", fallbackReason: "error" })),
            );
            portFinishedAt = yield* Clock.currentTimeMillis;
            yield* Deferred.succeed(prefetched, result);
          })
        : undefined;
    const noteSession = (s: RoutedSession): void => {
      Effect.runSync(Deferred.succeed(sessionReady, s));
    };
    const turnEffect = run(turn, noteSession);
    const sendAck = Effect.gen(this, function* () {
      sealed = true; // one ack only: narration pushed from here on is dropped
      const chosen = yield* chooseAckText({
        ack,
        canned: pickAckText(ack.texts, msg.id),
        narration: () => narration,
        acknowledge: () => (noPort ? undefined : Deferred.await(prefetched)),
      });
      // Model-ack latency: port start to its result, or to now when it timed out. Narration and
      // canned-only acks made no model attempt, so they carry none.
      const now = yield* Clock.currentTimeMillis;
      const ackLatencyMs =
        chosen.source !== "narration" && portStartedAt !== undefined
          ? Math.max(0, (portFinishedAt ?? now) - portStartedAt)
          : undefined;
      yield* this.reply(adapterId, msg, chosen.text, taskId);
      yield* this.emit({ _tag: "ChannelTurnAcknowledged", routeId: route.id, role, source: chosen.source, ...(ackLatencyMs !== undefined ? { ackLatencyMs } : {}),...(chosen.fallbackReason ? { ackFallbackReason: chosen.fallbackReason } : {}), simulated });
    }).pipe(
      Effect.catchAll((error) => emitErrorSwallowed({ site: "channels/src/routing/engine.ts:ack", tag: errorTag(error) })),
    );
    return withTurnAck(turnEffect, { ack, pulse: pulse?.pipe(Effect.ignore), sendAck, ...(background ? { background } : {}) });
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
