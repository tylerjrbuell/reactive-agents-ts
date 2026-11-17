import { Clock, Deferred, Effect, Either, Exit, Scope } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { channelSenderKey } from "@reactive-agents/gateway";
import {
  envelopeToInboundMessage,
  type DeliveryReceipt,
  type InboundEnvelope,
  type OutboundMessage,
  type SenderGate,
} from "../adapter.js";
import type { ChannelError } from "../errors.js";
import type { InboundMessage } from "../types.js";
import { AdapterHub } from "./adapter-hub.js";
import { chooseAckText, pickAckText, resolveAck, withTurnAck, type AckPortResult } from "./ack.js";
import { ConversationPolicy, combineMessages, type RunningTurn, type TurnEntry } from "./conversation-policy.js";
import { InboxTracker } from "./inbox-tracker.js";
import type { InboxCounts } from "./inbox.js";
import type { RouteMeter } from "./meter.js";
import { makeMemoryOutbox, OutboxDispatcher, type OutboxCounts, type OutboxOptions, type RouterOutbox } from "./outbox.js";
import {
  timerMessage,
  timerRouteOf,
  type FollowUpPort,
  type FollowUpTimers,
  type TimerBinding,
  type TimerCounts,
  type TimerRow,
} from "./timers.js";
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
  /** Outbox tuning and an explicit store (defaults to `store.outbox`, else memory). Strict engines only. */
  readonly outbox?: { readonly store?: RouterOutbox; readonly options?: OutboxOptions };
  /** Follow-up timers; present enables the `follow-up` capability and the timer wake-ups. Strict engines only. */
  readonly timers?: FollowUpTimers;
}

/** The route without its `when` filter: a timer re-enters the route that created it, whatever the wake-up text says. */
const withoutWhen = (route: RouteSpec): RouteSpec => {
  const { when: _when, ...match } = route.match;
  return { ...route, match };
};

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
  private readonly policy = new ConversationPolicy();
  private readonly inbox: InboxTracker;
  private readonly outbox: OutboxDispatcher | undefined;
  /** Timer ids a fire is in progress for; the poller skips them until the turn ends. */
  private readonly firing = new Set<string>();

  constructor(private readonly deps: EngineDeps) {
    this.inbox = new InboxTracker(deps.strict ? deps.store.inbox : undefined, (e) => this.emit(e));
    this.outbox = deps.strict
      ? new OutboxDispatcher(
          {
            store: deps.outbox?.store ?? deps.store.outbox ?? makeMemoryOutbox(),
            deliver: (adapterId, message, taskId) => this.hub.deliver(adapterId, message, taskId),
            emit: (e) => this.emit(e),
          },
          deps.outbox?.options,
        )
      : undefined;
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

  /**
   * Re-run one envelope recovered from the durable inbox. It skips dedupe (the row already exists)
   * and runs as its own turn: no batching or mid-run policy on a replay.
   */
  replay(adapterId: string, msg: InboundMessage): Effect.Effect<void, never> {
    return this.process(adapterId, msg, false, true).pipe(
      Effect.asVoid,
      Effect.catchAllCause((cause) =>
        emitErrorSwallowed({ site: "channels/src/routing/engine.ts:replay", tag: errorTag(cause) }),
      ),
    );
  }

  /**
   * Startup recovery for a durable inbox: orphaned turns return to `received` (or fail when out of
   * attempts, reported), then every pending envelope whose adapter is registered runs again, oldest
   * first. No-op without an inbox.
   */
  replayInbox(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const entries = self.inbox.enabled ? yield* self.inbox.recover() : [];
      // Replies a crash left unsent go out first, except those whose turn is about to run again.
      if (self.deps.store.outbox) {
        yield* self.outbox?.recover(new Set(entries.map((e) => e.key)), (id) => self.hub.has(id), self.deps.taskId) ?? Effect.void;
      }
      if (self.deps.timers) yield* Effect.ignore(self.deps.timers.store.prune());
      for (const entry of entries) {
        if (self.hub.has(entry.adapterId)) yield* self.replay(entry.adapterId, entry.message);
      }
    });
  }

  /** Envelope counts per status, when the store has a durable inbox. */
  inboxCounts(): Effect.Effect<InboxCounts | undefined> {
    return this.inbox.counts();
  }

  /** Outgoing message counts per status, when the store has a durable outbox. */
  outboxCounts(): Effect.Effect<OutboxCounts | undefined> {
    return this.deps.store.outbox && this.outbox ? this.outbox.counts() : Effect.succeed(undefined);
  }

  /** Follow-up timer counts per status, when the router runs with timers. */
  timerCounts(): Effect.Effect<TimerCounts | undefined> {
    const timers = this.deps.timers;
    if (!timers) return Effect.succeed(undefined);
    return timers.store.counts().pipe(
      Effect.catchAll((error) =>
        Effect.as(emitErrorSwallowed({ site: "channels/src/routing/engine.ts:timerCounts", tag: errorTag(error) }), undefined),
      ),
    );
  }

  /**
   * Send through a registered adapter with the outbox's retry, order and pacing, and get the real
   * receipt. A non-strict engine (`ChannelService`) sends directly, as it always did.
   */
  send(
    adapterId: string,
    message: OutboundMessage,
    taskId: string = this.deps.taskId(),
    extra: { readonly resume?: boolean; readonly sourceKey?: string; readonly minGapMs?: number } = {},
  ): Effect.Effect<DeliveryReceipt, ChannelError> {
    return this.outbox ? this.outbox.send(adapterId, message, { taskId, ...extra }) : this.hub.deliver(adapterId, message, taskId);
  }

  // ── Follow-up timers ────────────────────────────────────────────────────

  /** Timers due now that no fire is already handling; each is marked as firing until {@link fireTimer} ends. */
  dueTimers(): Effect.Effect<ReadonlyArray<TimerRow>> {
    const self = this;
    const timers = this.deps.timers;
    if (!timers) return Effect.succeed([]);
    return timers.due().pipe(
      Effect.map((rows) => rows.filter((r) => !self.firing.has(r.id))),
      Effect.tap((rows) => Effect.sync(() => rows.forEach((r) => self.firing.add(r.id)))),
      Effect.catchAll((error) =>
        Effect.as(emitErrorSwallowed({ site: "channels/src/routing/engine.ts:dueTimers", tag: errorTag(error) }), []),
      ),
    );
  }

  /**
   * Wake a conversation: the due timer becomes an inbound message (id `timer-<id>`) on the normal
   * path, so dedupe, access, rate caps and the turn queue all apply. The timer is marked fired once
   * the message was handled; a crash before that fires it again, and the dedupe key refuses the duplicate.
   */
  fireTimer(row: TimerRow): Effect.Effect<void> {
    const self = this;
    const timers = this.deps.timers;
    return Effect.gen(function* () {
      yield* self.emit({ _tag: "ChannelFollowUpFired", routeId: row.routeId, timerId: row.id });
      yield* self.handleInbound(row.adapterId, timerMessage(row));
      if (timers) {
        yield* timers.store.fired(row.id).pipe(
          Effect.catchAll((error) =>
            emitErrorSwallowed({ site: "channels/src/routing/engine.ts:fireTimer", tag: errorTag(error) }),
          ),
        );
      }
    }).pipe(Effect.ensuring(Effect.sync(() => void self.firing.delete(row.id))));
  }

  /** The conversation's timer capability, with a receipt event per change. Never carries the note. */
  private followUpFor(binding: TimerBinding): FollowUpPort | undefined {
    const timers = this.deps.timers;
    if (!timers) return undefined;
    const port = timers.bind(binding);
    return {
      schedule: (request) =>
        port.schedule(request).pipe(
          Effect.tap((timer) =>
            this.emit({ _tag: "ChannelFollowUpScheduled", routeId: binding.routeId, timerId: timer.id, dueAt: timer.dueAt }),
          ),
        ),
      cancel: (id) =>
        port.cancel(id).pipe(
          Effect.tap((found) =>
            found
              ? this.emit({ _tag: "ChannelFollowUpCancelled", routeId: binding.routeId, timerId: id })
              : Effect.void,
          ),
        ),
      pending: port.pending,
    };
  }

  private process(adapterId: string, msg: InboundMessage, simulated: boolean, replayed = false): Effect.Effect<RouteOutcome> {
    const self = this;
    const deps = this.deps;
    return Effect.gen(function* () {
      if (!simulated) self.hub.noteReceived(adapterId);
      const taskId = deps.taskId();
      const seenKey = `${adapterId}:${msg.id}`;
      // Simulations never touch the durable inbox: a stored simulation would be replayed as a real turn.
      const keys: ReadonlyArray<string> = simulated || !self.inbox.enabled ? [] : [seenKey];
      if (deps.strict && !replayed) {
        const fresh = keys.length > 0 ? yield* self.inbox.accept(seenKey, adapterId, msg) : yield* deps.store.markSeen(seenKey);
        if (!fresh) return { _tag: "Duplicate" } as const;
      }
      const settled = (outcome: RouteOutcome): Effect.Effect<RouteOutcome> =>
        Effect.as(self.inbox.settle(keys, outcome), outcome);
      const routes = yield* deps.store.getRoutes;
      const platform = self.hub.platformOf(adapterId) ?? msg.platform;
      const input = matchInputOf(adapterId, msg);
      // A follow-up timer re-enters the route that created it (only when timers are on; the id check keeps a platform message from claiming it).
      const pinned = deps.timers ? timerRouteOf(msg) : undefined;
      const route =
        pinned !== undefined
          ? matchRoute(routes.filter((r) => r.id === pinned).map(withoutWhen), input)
          : matchRoute(routes, input);
      if (!route) {
        self.unrouted += 1;
        yield* self.emit({ _tag: "ChannelUnrouted", channelId: adapterId, simulated });
        return yield* settled({ _tag: "Unrouted" } as const);
      }

      const verdict = yield* (deps.access
        ? deps.access(route, platform, msg, adapterId)
        : decideRouteAccess(route, platform, msg.senderId));
      if (!verdict.allowed) {
        yield* self.emit({ _tag: "ChannelRouteDenied", routeId: route.id, channelId: adapterId, simulated });
        if (verdict.reply !== undefined && !simulated && self.hub.has(adapterId)) {
          yield* self.reply(adapterId, msg, verdict.reply, taskId, route).pipe(Effect.ignore);
        }
        return yield* settled({ _tag: "Denied", routeId: route.id, reason: verdict.reason } as const);
      }
      const role = verdict.role;
      yield* self.emit({ _tag: "ChannelRouteMatched", routeId: route.id, channelId: adapterId, role, simulated });

      if (deps.strict) {
        if (!groupAllowed(route, input)) return yield* settled(yield* self.drop("group", route.id, simulated));
      }

      const key = `${route.id}:${role}:${conversationKeyOf(adapterId, msg)}`;
      // Owner reset command: handled here, never forwarded to the agent, exempt from the turn-rate cap.
      if (deps.strict && role === "owner" && isResetCommand(route, msg.content)) {
        return yield* settled(
          yield* self.queued(key, true, () => self.resetConversation({ adapterId, msg, route, role, key, taskId, simulated }), {
            onOverflow: () => self.drop("backpressure", route.id, simulated),
          }),
        );
      }
      const entry: TurnEntry = { adapterId, msg, route, role, key, taskId, simulated, keys };
      if (deps.strict && !simulated && !replayed && (route.batchWindowMs ?? 0) > 0) {
        return yield* self.policy.batch(
          entry,
          (combined) => self.dispatch(combined, platform, replayed),
          (size, sourceIds) => self.emit({ _tag: "ChannelInboxBatched", routeId: route.id, size, sourceIds }),
        );
      }
      return yield* self.dispatch(entry, platform, replayed);
    });
  }

  /**
   * From access-checked entry to a settled outcome: mid-run policy for a conversation whose turn is
   * running, the turn-rate cap, the bounded queue, then the turn itself.
   */
  private dispatch(entry: TurnEntry, platform: string, replayed: boolean): Effect.Effect<RouteOutcome> {
    const self = this;
    const deps = this.deps;
    const { route, key, msg, simulated } = entry;
    const mode = route.midRun ?? "queue";
    return Effect.gen(function* () {
      if (deps.strict && !simulated && !replayed && mode !== "queue") {
        const running = self.policy.runningFor(key);
        if (running) {
          yield* self.emitJoined(entry, mode);
          const outcome = yield* self.policy.absorb(running, entry, mode, deps.conversationQueue ?? DEFAULT_CONVERSATION_QUEUE);
          return outcome ?? (yield* self.overflow(entry));
        }
      }
      if (deps.strict && !(yield* self.withinRate(route, platform, msg))) {
        const dropped = yield* self.drop("rate", route.id, simulated);
        yield* self.inbox.settle(entry.keys, dropped);
        return dropped;
      }
      return yield* self.queued(key, deps.strict, () => self.turnLoop(entry, replayed), {
        onOverflow: () => self.overflow(entry),
      });
    });
  }

  /** Record that an envelope joined a running turn (the receipt for fold and interrupt). */
  private emitJoined(entry: TurnEntry, mode: "fold" | "interrupt"): Effect.Effect<void> {
    const { id: sourceId } = entry.msg;
    const routeId = entry.route.id;
    return this.emit(
      mode === "fold" ? { _tag: "ChannelInboxFolded", routeId, sourceId } : { _tag: "ChannelInboxInterrupted", routeId, sourceId },
    );
  }

  /** Conversation backlog full: notice once per backlog, count it, settle the rows as dropped. */
  private overflow(entry: TurnEntry): Effect.Effect<RouteOutcome> {
    const self = this;
    const { adapterId, msg, route, key, taskId, simulated } = entry;
    return Effect.gen(function* () {
      if (!simulated && !self.notified.has(key) && self.hub.has(adapterId)) {
        self.notified.add(key);
        yield* self.reply(adapterId, msg, BACKPRESSURE_NOTICE, taskId, route).pipe(Effect.ignore);
      }
      const outcome = yield* self.drop("backpressure", route.id, simulated);
      yield* self.inbox.settle(entry.keys, outcome);
      return outcome;
    });
  }

  /**
   * One turn, plus what follows it on a `fold` or `interrupt` route: an interrupted attempt restarts
   * from the combined input, messages nobody drained run as one follow-up turn. Every inbox row the
   * turn covered is marked running at the start and settled with the outcome.
   */
  private turnLoop(entry: TurnEntry, replayed: boolean): Effect.Effect<RouteOutcome> {
    const self = this;
    const mode = entry.route.midRun ?? "queue";
    if (!this.deps.strict || entry.simulated || replayed || mode === "queue") {
      return Effect.gen(function* () {
        yield* self.inbox.begin(entry.keys);
        const outcome = yield* self.runTurn(entry);
        yield* self.inbox.settle(entry.keys, outcome);
        return outcome;
      });
    }
    return Effect.suspend(() => {
      const turn = self.policy.open(entry.key, entry.keys);
      let final: RouteOutcome | undefined;
      return Effect.gen(function* () {
        let current = entry;
        for (;;) {
          final = undefined;
          self.policy.arm(turn, current.keys, mode);
          yield* self.inbox.begin(current.keys);
          const outcome: RouteOutcome = yield* self.runTurn(current, { mode, turn });
          if (outcome._tag === "Failed" && outcome.error.reason === "turn_interrupted") {
            const next = self.policy.drain(turn);
            current = { ...current, msg: combineMessages(current.msg, next.msgs), keys: [...turn.keys, ...next.keys] };
            continue;
          }
          final = outcome;
          yield* self.inbox.settle(turn.keys, outcome);
          const rest = self.policy.drain(turn);
          const [head, ...tail] = rest.msgs;
          if (head === undefined) return outcome;
          current = { ...current, msg: combineMessages(head, tail), keys: rest.keys };
        }
      }).pipe(Effect.ensuring(Effect.suspend(() => self.policy.close(entry.key, final))));
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
    simulated = false,
  ): Effect.Effect<{ readonly session: RoutedSession; readonly scope: Scope.CloseableScope }, RoutingError> {
    const self = this;
    return Effect.gen(function* () {
      const stateless = route.session === "stateless";
      const threadId = msg.metadata["threadId"];
      const followUp =
        simulated || !self.deps.strict
          ? undefined
          : self.followUpFor({
              adapterId,
              platform: msg.platform,
              channelId: msg.channelId,
              ...(typeof threadId === "string" ? { threadId } : {}),
              isGroup: msg.metadata["isGroup"] === true,
              routeId: route.id,
              senderId: msg.senderId,
            });
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
          ...(followUp ? { followUp } : {}),
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
      const sent = yield* Effect.either(self.reply(adapterId, msg, reply.text, taskId, route));
      return Either.isRight(sent)
        ? ({ _tag: "Answered", routeId: route.id, role, reply, receipt: sent.right } as const)
        : ({ _tag: "Answered", routeId: route.id, role, reply, deliveryError: sent.left } as const);
    });
  }

  private runTurn(
    args: TurnEntry,
    live?: { readonly mode: "fold" | "interrupt"; readonly turn: RunningTurn },
  ): Effect.Effect<RouteOutcome> {
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
        ...(live?.mode === "fold" ? { takeFolded: () => self.policy.take(live.turn) } : {}),
      };
      const attempt = yield* Effect.either(
        self.acknowledged(route, role, adapterId, msg, taskId, simulated, baseTurn, (turn, noteSession) => Effect.gen(function* () {
          const entry = yield* self.session(key, route, role, adapterId, msg, simulated);
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
          const closed = route.session === "stateless"
            ? bounded.pipe(Effect.ensuring(Scope.close(entry.scope, Exit.void)))
            : bounded;
          // `interrupt`: a newer envelope cancels this attempt with a typed error; partial work stays in the session.
          return yield* live?.mode === "interrupt"
            ? Effect.raceFirst(
                closed,
                Effect.zipRight(
                  Deferred.await(live.turn.signal),
                  Effect.fail(new RoutingError({ reason: "turn_interrupted", message: `route ${route.id}: turn interrupted by a newer message`, routeId: route.id })),
                ),
              )
            : closed;
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
        if (self.deps.strict && route.failureNotice && !simulated && attempt.left.reason !== "turn_interrupted" && self.hub.has(adapterId)) {
          // Best effort: `deliver` already counts and publishes a failed send; the turn outcome stays Failed.
          yield* self.reply(adapterId, msg, failureNoticeText(attempt.left, route), taskId, route).pipe(Effect.ignore);
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
      const sent = yield* Effect.either(self.reply(adapterId, msg, reply.text, taskId, route, args.keys));
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
      yield* this.reply(adapterId, msg, chosen.text, taskId, route);
      yield* this.emit({ _tag: "ChannelTurnAcknowledged", routeId: route.id, role, source: chosen.source, ...(ackLatencyMs !== undefined ? { ackLatencyMs } : {}),...(chosen.fallbackReason ? { ackFallbackReason: chosen.fallbackReason } : {}), simulated });
    }).pipe(
      Effect.catchAll((error) => emitErrorSwallowed({ site: "channels/src/routing/engine.ts:ack", tag: errorTag(error) })),
    );
    return withTurnAck(turnEffect, { ack, pulse: pulse?.pipe(Effect.ignore), sendAck, ...(background ? { background } : {}) });
  }

  /** Reply through the same adapter. A failed delivery is already counted and published by `deliver`. */
  private reply(
    adapterId: string,
    msg: InboundMessage,
    text: string,
    taskId: string,
    route: RouteSpec,
    answers?: ReadonlyArray<string>,
  ) {
    return this.send(
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
      {
        ...(route.minGapMs !== undefined ? { minGapMs: route.minGapMs } : {}),
        // Only an agent's answer is worth sending after a restart; acks and notices go stale.
        ...(answers !== undefined && answers.length > 0 ? { resume: true, sourceKey: answers.join("\n") } : {}),
      },
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
