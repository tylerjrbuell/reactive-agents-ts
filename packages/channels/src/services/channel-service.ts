import { Effect, Exit, Scope, Stream } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { GatewayEvent, PolicyDecision } from "@reactive-agents/gateway";
import {
  envelopeToInboundMessage,
  isChannelAdapter,
  type ChannelAdapter,
  type ConnectionState,
  type DeliveryReceipt,
  type InboundEnvelope,
  type OutboundMessage,
} from "../adapter.js";
import {
  channelError,
  classifyChannelFailure,
  type ChannelConnectionError,
  type ChannelError,
} from "../errors.js";
import type {
  AdapterInfo,
  ChannelStatus,
  InboundMessage,
  MessageChannel,
  TriggerAgentConfig,
  TriggerDefinition,
} from "../types.js";
import { SessionBridge } from "./session-bridge.js";
import { TriggerRegistry } from "./trigger-registry.js";

export interface ChannelServiceDeps {
  readonly triggers: TriggerRegistry;
  readonly sessions: SessionBridge;
  /**
   * Policy evaluation for inbound messages (typically wraps `GatewayService.processEvent`
   * or `evaluatePolicies` with the gateway policy list). The event carries the platform, so the
   * access-control policy keys senders as `platform:userId` (gateway `channelSenderKey`).
   */
  readonly evaluatePolicy: (event: GatewayEvent) => Effect.Effect<PolicyDecision, never>;
  readonly taskId: () => string;
  /**
   * Fixed reply sent (via the same adapter) to a sender the access policy denied as an
   * unknown sender (`code: "unknown-sender"`). Never run through the agent. Blocklisted
   * senders and empty-sender events get no reply.
   */
  readonly replyToUnknown?: string;
  /**
   * Side-effect-free sender check used to gate attachment downloads before any bytes are fetched.
   * Defaults to evaluating `evaluatePolicy` with an attachment-gate probe event.
   */
  readonly allowSender?: (sender: { readonly platform: string; readonly userId: string }) => Effect.Effect<boolean>;
  readonly eventBus?: { publish: (e: AgentEvent) => Effect.Effect<void, never> };
  /** Inbound envelopes processed in parallel per adapter (turns for one sender stay FIFO). Default 4. */
  readonly inboundConcurrency?: number;
}

/** How the service talks to one registered adapter, new contract or legacy. */
interface RegisteredAdapter {
  readonly id: string;
  readonly platform: string;
  readonly send: (m: OutboundMessage) => Effect.Effect<DeliveryReceipt, ChannelError>;
  readonly state: ConnectionState;
  /** Re-read state from the adapter (canonical adapters only). */
  readonly readState?: Effect.Effect<ConnectionState>;
  readonly deliveryFailures: number;
  readonly lastError?: ChannelError;
}

function toGatewayEvent(adapterId: string, msg: InboundMessage): GatewayEvent {
  return {
    id: msg.id,
    source: "channel",
    timestamp: msg.timestamp,
    priority: "normal",
    payload: msg.content,
    // Adapter-supplied metadata may be attacker-influenced (webhook bodies); identity fields
    // that access control keys on must come last so they cannot be overridden.
    metadata: {
      ...msg.metadata,
      sender: msg.senderId,
      platform: msg.platform,
      adapterId,
    },
  };
}

function resolveAgentConfig(
  triggers: TriggerRegistry,
  trigger: TriggerDefinition | null,
  msg: InboundMessage,
): TriggerAgentConfig | undefined {
  const base = trigger?.agent ?? triggers.getDefaultAgent();
  const derive = trigger?.agent?.derive;
  if (!derive) return base;
  return SessionBridge.mergeAgentConfig(base, derive(msg));
}

/**
 * Orchestrates adapters -> policy -> triggers -> {@link SessionBridge}, and delivers replies
 * itself through `adapter.send` (no dependence on the LLM calling a tool).
 *
 * Accepts the canonical {@link ChannelAdapter} and, for compatibility, the legacy
 * {@link MessageChannel}. Call {@link ChannelService#shutdown} to stop consuming and disconnect
 * canonical adapters.
 */
export class ChannelService {
  private readonly adapters = new Map<string, RegisteredAdapter>();
  private scope?: Scope.CloseableScope;
  private totalProcessed = 0;

  constructor(private readonly deps: ChannelServiceDeps) {}

  registerAdapter(adapter: MessageChannel | ChannelAdapter): Effect.Effect<void, ChannelConnectionError | ChannelError> {
    return isChannelAdapter(adapter) ? this.registerCanonical(adapter) : this.registerLegacy(adapter);
  }

  private update(id: string, patch: Partial<RegisteredAdapter>): void {
    const cur = this.adapters.get(id);
    if (cur) this.adapters.set(id, { ...cur, ...patch });
  }

  private registerLegacy(adapter: MessageChannel): Effect.Effect<void, ChannelConnectionError> {
    const self = this;
    return Effect.gen(function* () {
      yield* adapter.connect();
      yield* adapter.onMessage((msg) => self.handleInbound(adapter.id, msg));
      self.adapters.set(adapter.id, {
        id: adapter.id,
        platform: adapter.id,
        state: { status: "connected" },
        deliveryFailures: 0,
        send: (m) =>
          adapter
            .sendMessage(
              {
                channelId: m.conversation.channelId,
                ...(m.conversation.threadId !== undefined ? { threadId: m.conversation.threadId } : {}),
                ...(m.replyTo !== undefined ? { replyToMessageId: m.replyTo } : {}),
              },
              { text: m.text, ...(m.format !== undefined ? { format: m.format } : {}) },
            )
            .pipe(
              Effect.map((r): DeliveryReceipt => ({
                messageId: r.messageId,
                adapterId: adapter.id,
                platform: adapter.id,
                status: "sent",
                sentAt: r.timestamp.getTime(),
              })),
              Effect.mapError((e) => classifyChannelFailure(adapter.id, e)),
            ),
      });
    });
  }

  private registerCanonical(adapter: ChannelAdapter): Effect.Effect<void, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const scope = self.scope ?? (self.scope = yield* Scope.make());
      // Adapters must ask before downloading a stranger's attachments. Prefer the side-effect-free
      // `allowSender`; otherwise fall back to the policy decision (counts one extra policy pass).
      adapter.setSenderGate?.((sender) => {
        if (self.deps.allowSender) return self.deps.allowSender(sender);
        return self.deps
          .evaluatePolicy({
            id: `${adapter.id}:attachment-gate`,
            source: "channel",
            timestamp: new Date(),
            priority: "normal",
            payload: "",
            metadata: { sender: sender.userId, platform: sender.platform, adapterId: adapter.id },
          })
          .pipe(Effect.map((d) => d.action === "execute"));
      });
      self.adapters.set(adapter.id, {
        id: adapter.id,
        platform: adapter.platform,
        send: adapter.send.bind(adapter),
        state: yield* adapter.currentState,
        readState: adapter.currentState,
        deliveryFailures: 0,
      });
      yield* Scope.extend(adapter.start(), scope);
      self.update(adapter.id, { state: yield* adapter.currentState });
      yield* Effect.forkIn(
        Stream.runForEach(adapter.state, (s) => Effect.sync(() => self.update(adapter.id, { state: s }))),
        scope,
      );
      const concurrency = self.deps.inboundConcurrency ?? 4;
      yield* Effect.forkIn(
        adapter.inbound.pipe(
          Stream.mapEffect((env) => self.handleEnvelope(adapter.id, env), { concurrency }),
          Stream.runDrain,
          Effect.catchAll((error) => Effect.sync(() => self.update(adapter.id, { state: { status: "failed", error } }))),
        ),
        scope,
      );
    });
  }

  /** Stop consuming inbound and disconnect every canonical adapter. Idempotent. */
  shutdown(): Effect.Effect<void> {
    const scope = this.scope;
    this.scope = undefined;
    if (!scope) return Effect.void;
    const self = this;
    return Effect.gen(function* () {
      yield* Scope.close(scope, Exit.void);
      // The state-tracking fiber is interrupted with the scope; re-read the final states.
      for (const reg of [...self.adapters.values()]) {
        if (reg.readState) self.update(reg.id, { state: yield* reg.readState });
      }
    });
  }

  /**
   * Send a message through a registered adapter and return its real {@link DeliveryReceipt}.
   * Publishes `ChannelMessageSent` (with the receipt's message id) only on success. On failure it
   * records the failure in `status()`, publishes a `ChannelDeliveryFailed` event and fails with the
   * typed {@link ChannelError}. Workflow Deliver nodes call this.
   */
  deliver(
    adapterId: string,
    message: OutboundMessage,
    taskId: string = this.deps.taskId(),
  ): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const reg = self.adapters.get(adapterId);
      if (!reg) {
        return yield* Effect.fail(
          channelError(adapterId, "not_found", { message: `channel ${adapterId}: adapter not registered` }),
        );
      }
      const bus = self.deps.eventBus;
      return yield* reg.send(message).pipe(
        Effect.tap((receipt) =>
          bus
            ? bus.publish({
                _tag: "ChannelMessageSent",
                taskId,
                platform: receipt.platform,
                messageId: receipt.messageId,
                channelId: message.conversation.channelId,
                timestamp: Date.now(),
              })
            : Effect.void,
        ),
        Effect.tapError((error) =>
          Effect.suspend(() => {
            const failures = (self.adapters.get(adapterId)?.deliveryFailures ?? 0) + 1;
            self.update(adapterId, { deliveryFailures: failures, lastError: error });
            // Classification and ids only; never the cause, which may carry secrets.
            return bus
              ? bus.publish({
                  _tag: "ChannelDeliveryFailed",
                  taskId,
                  adapterId,
                  kind: error.kind,
                  retryable: error.retryable,
                  ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
                  conversationId: message.conversation.channelId,
                })
              : Effect.void;
          }),
        ),
      );
    });
  }

  /** Process one canonical inbound envelope: echoes are dropped, the rest follow {@link handleInbound}. */
  handleEnvelope(adapterId: string, env: InboundEnvelope): Effect.Effect<void, never> {
    if (env.isEcho) return Effect.void;
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

  handleInbound(adapterId: string, msg: InboundMessage): Effect.Effect<void, never> {
    const self = this;
    // A failed reply is already counted in status() and published as ChannelDeliveryFailed by
    // `deliver`; the inbound pipeline must carry on, so the typed error ends here.
    const reply = (text: string, taskId: string) =>
      self
        .deliver(
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
        )
        .pipe(Effect.ignore);

    return Effect.gen(function* () {
      const taskId = self.deps.taskId();
      const decision = yield* self.deps.evaluatePolicy(toGatewayEvent(adapterId, msg));
      if (decision.action !== "execute") {
        const replyText = self.deps.replyToUnknown;
        const denied =
          (decision.action === "skip" || decision.action === "escalate") &&
          decision.code === "unknown-sender";
        if (replyText && denied && self.adapters.has(adapterId)) yield* reply(replyText, taskId);
        return;
      }

      const trigger = self.deps.triggers.evaluate(msg);
      const agentConfig = resolveAgentConfig(self.deps.triggers, trigger, msg);

      const params = {
        identity: {
          platform: msg.platform,
          userId: msg.senderId,
          displayName: msg.senderName,
          metadata: {},
        },
        channelId: msg.channelId,
        agentConfig,
        lifecycle: trigger?.lifecycle,
      };

      const { sessionId, reply: answer } = yield* self.deps.sessions.runChatTurn(params, msg.content).pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({ site: "channels/src/services/channel-service.ts:runChatTurn", tag: errorTag(err) }).pipe(
            Effect.as({ sessionId: "", reply: "" }),
          ),
        ),
      );

      self.totalProcessed += 1;

      const bus = self.deps.eventBus;
      if (bus && trigger) {
        yield* bus.publish({
          _tag: "TriggerFired",
          taskId,
          triggerId: trigger.id,
          triggerName: trigger.name,
          platform: msg.platform,
          sessionId,
          timestamp: Date.now(),
        });
      }

      if (answer && self.adapters.has(adapterId)) yield* reply(answer, taskId);
    }).pipe(Effect.catchAll((err) =>
      emitErrorSwallowed({ site: "channels/src/services/channel-service.ts:processMessage", tag: errorTag(err) }),
    ));
  }

  /** Honest status: `connected` mirrors each adapter's reported connection state. */
  status(): ChannelStatus {
    const adapters: AdapterInfo[] = [...this.adapters.values()].map((a) => ({
      id: a.id,
      connected: a.state.status === "connected",
      sessionsActive: 0,
      state: a.state,
      deliveryFailures: a.deliveryFailures,
      ...(a.lastError ? { lastError: a.lastError } : {}),
    }));
    return {
      adapters,
      activeSessions: this.deps.sessions.size(),
      totalMessagesProcessed: this.totalProcessed,
    };
  }
}

/** Test helper: always allow execution. */
export const alwaysExecutePolicy = (_event: GatewayEvent): Effect.Effect<PolicyDecision, never> =>
  Effect.succeed({ action: "execute", taskDescription: "channel" });
