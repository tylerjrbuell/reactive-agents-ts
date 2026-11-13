import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { GatewayEvent, PolicyDecision } from "@reactive-agents/gateway";
import type {
  ChannelAdapter,
  DeliveryReceipt,
  InboundEnvelope,
  OutboundMessage,
} from "../adapter.js";
import type { ChannelConnectionError, ChannelError } from "../errors.js";
import { RouterEngine } from "../routing/engine.js";
import type { AccessVerdict } from "../routing/match.js";
import { makeMemoryRouterStore } from "../routing/store.js";
import type { AgentResolver, RouteSpec, RoutedSession, RoutedTurn } from "../routing/types.js";
import type {
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

/**
 * The one implicit route a {@link ChannelService} runs: it matches every channel, and the gateway
 * policy (not the route's own lists) decides who may talk, so `open` here only means "defer to
 * the injected policy". Its caps are never enforced because the engine runs non-strict.
 */
const IMPLICIT_ROUTE: RouteSpec = {
  id: "implicit",
  enabled: true,
  priority: 100,
  match: { channelId: "*" },
  target: { agentId: "default" },
  session: "per-conversation",
  allow: [],
  deny: [],
  owners: [],
  open: true,
  senderTools: { _tag: "AgentDefault" },
  groups: "mention-only",
  turnTimeoutMs: 120_000,
  resetCommands: [],
};

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
 * It is a one-route router: a {@link RouterEngine} with a single implicit route, the gateway
 * policy as the access decision and the trigger registry plus session bridge as the agent
 * resolver. Accepts the canonical {@link ChannelAdapter} and, for compatibility, the legacy
 * {@link MessageChannel}. Call {@link ChannelService#shutdown} to stop consuming and disconnect
 * canonical adapters.
 */
export class ChannelService {
  private readonly engine: RouterEngine;

  constructor(private readonly deps: ChannelServiceDeps) {
    const store = makeMemoryRouterStore([IMPLICIT_ROUTE]);
    const agents: AgentResolver = {
      open: () => Effect.succeed<RoutedSession>({ send: (turn) => this.runTurn(turn), close: Effect.void }),
    };
    this.engine = new RouterEngine({
      store,
      agents,
      taskId: deps.taskId,
      ...(deps.eventBus ? { eventBus: deps.eventBus } : {}),
      ...(deps.inboundConcurrency !== undefined ? { inboundConcurrency: deps.inboundConcurrency } : {}),
      strict: false,
      access: (_route, _platform, msg, adapterId) => this.access(adapterId, msg),
      senderGate: (adapterId, sender) => this.allowSender(adapterId, sender),
    });
  }

  /** The gateway policy decides; an unknown-sender denial may get the fixed reply. */
  private access(adapterId: string, msg: InboundMessage): Effect.Effect<AccessVerdict> {
    return this.deps.evaluatePolicy(toGatewayEvent(adapterId, msg)).pipe(
      Effect.map((decision): AccessVerdict => {
        if (decision.action === "execute") return { allowed: true, role: "owner" };
        const replyText = this.deps.replyToUnknown;
        const unknown =
          (decision.action === "skip" || decision.action === "escalate") && decision.code === "unknown-sender";
        return {
          allowed: false,
          reason: "reason" in decision ? decision.reason : decision.action,
          ...(replyText && unknown ? { reply: replyText } : {}),
        };
      }),
    );
  }

  /** Adapters must ask before downloading a stranger's attachments. */
  private allowSender(
    adapterId: string,
    sender: { readonly platform: string; readonly userId: string },
  ): Effect.Effect<boolean> {
    if (this.deps.allowSender) return this.deps.allowSender(sender);
    // Fallback to the policy decision (counts one extra policy pass).
    return this.deps
      .evaluatePolicy({
        id: `${adapterId}:attachment-gate`,
        source: "channel",
        timestamp: new Date(),
        priority: "normal",
        payload: "",
        metadata: { sender: sender.userId, platform: sender.platform, adapterId },
      })
      .pipe(Effect.map((d) => d.action === "execute"));
  }

  /** Trigger match, then one chat turn on the sender's session. A failed turn yields an empty reply. */
  private runTurn(turn: RoutedTurn): Effect.Effect<{ readonly text: string }> {
    const { triggers, sessions, eventBus } = this.deps;
    const msg = turn.message;
    return Effect.gen(function* () {
      const trigger = triggers.evaluate(msg);
      const agentConfig = resolveAgentConfig(triggers, trigger, msg);
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
      const { sessionId, reply } = yield* sessions.runChatTurn(params, msg.content).pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({ site: "channels/src/services/channel-service.ts:runChatTurn", tag: errorTag(err) }).pipe(
            Effect.as({ sessionId: "", reply: "" }),
          ),
        ),
      );
      if (eventBus && trigger) {
        yield* eventBus.publish({
          _tag: "TriggerFired",
          taskId: turn.taskId,
          triggerId: trigger.id,
          triggerName: trigger.name,
          platform: msg.platform,
          sessionId,
          timestamp: Date.now(),
        });
      }
      return { text: reply };
    });
  }

  registerAdapter(adapter: MessageChannel | ChannelAdapter): Effect.Effect<void, ChannelConnectionError | ChannelError> {
    return this.engine.hub.register(adapter);
  }

  /** Stop consuming inbound and disconnect every canonical adapter. Idempotent. */
  shutdown(): Effect.Effect<void> {
    return this.engine.shutdown();
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
    taskId?: string,
  ): Effect.Effect<DeliveryReceipt, ChannelError> {
    return this.engine.hub.deliver(adapterId, message, taskId);
  }

  /** Process one canonical inbound envelope: echoes are dropped, the rest follow {@link handleInbound}. */
  handleEnvelope(adapterId: string, env: InboundEnvelope): Effect.Effect<void, never> {
    return this.engine.handleEnvelope(adapterId, env);
  }

  handleInbound(adapterId: string, msg: InboundMessage): Effect.Effect<void, never> {
    return this.engine.handleInbound(adapterId, msg);
  }

  /** Honest status: `connected` mirrors each adapter's reported connection state. */
  status(): ChannelStatus {
    return {
      adapters: this.engine.hub.info(),
      activeSessions: this.deps.sessions.size(),
      totalMessagesProcessed: this.engine.processed,
    };
  }
}

/** Test helper: always allow execution. */
export const alwaysExecutePolicy = (_event: GatewayEvent): Effect.Effect<PolicyDecision, never> =>
  Effect.succeed({ action: "execute", taskDescription: "channel" });
