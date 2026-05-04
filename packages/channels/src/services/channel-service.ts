import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import type { GatewayEvent, PolicyDecision } from "@reactive-agents/gateway";
import type { ChannelConnectionError } from "../errors.js";
import type { AdapterInfo, ChannelStatus, InboundMessage, MessageChannel, TriggerDefinition } from "../types.js";
import { SessionBridge } from "./session-bridge.js";
import { TriggerRegistry } from "./trigger-registry.js";

export interface ChannelServiceDeps {
  readonly triggers: TriggerRegistry;
  readonly sessions: SessionBridge;
  /**
   * Policy evaluation for inbound messages (typically wraps `GatewayService.processEvent`
   * or `evaluatePolicies` with the gateway policy list).
   */
  readonly evaluatePolicy: (event: GatewayEvent) => Effect.Effect<PolicyDecision, never>;
  readonly taskId: () => string;
  readonly eventBus?: { publish: (e: AgentEvent) => Effect.Effect<void, never> };
}

function toGatewayEvent(adapterId: string, msg: InboundMessage, _taskId: string): GatewayEvent {
  return {
    id: msg.id,
    source: "channel",
    timestamp: msg.timestamp,
    priority: "normal",
    payload: msg.content,
    metadata: {
      sender: msg.senderId,
      platform: msg.platform,
      adapterId,
      ...msg.metadata,
    },
  };
}

function resolveAgentConfig(
  triggers: TriggerRegistry,
  trigger: TriggerDefinition | null,
  msg: InboundMessage,
): import("../types.js").TriggerAgentConfig | undefined {
  const base = trigger?.agent ?? triggers.getDefaultAgent();
  const derive = trigger?.agent?.derive;
  if (!derive) return base;
  return SessionBridge.mergeAgentConfig(base, derive(msg));
}

/**
 * Orchestrates adapters → policy → triggers → {@link SessionBridge} (bot / webhook ingress).
 */
export class ChannelService {
  private readonly adapters = new Map<string, MessageChannel>();
  private totalProcessed = 0;

  constructor(private readonly deps: ChannelServiceDeps) {}

  registerAdapter(adapter: MessageChannel): Effect.Effect<void, ChannelConnectionError> {
    const self = this;
    return Effect.gen(function* () {
      yield* adapter.connect();
      yield* adapter.onMessage((msg) => self.handleInbound(adapter.id, msg));
      self.adapters.set(adapter.id, adapter);
    });
  }

  handleInbound(adapterId: string, msg: InboundMessage): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      const taskId = self.deps.taskId();
      const gwEvent = toGatewayEvent(adapterId, msg, taskId);
      const decision = yield* self.deps.evaluatePolicy(gwEvent);
      if (decision.action !== "execute") return;

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

      const { sessionId, reply } = yield* self.deps.sessions.runChatTurn(params, msg.content).pipe(
        Effect.catchAll(() => Effect.succeed({ sessionId: "", reply: "" })),
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
        } as unknown as AgentEvent);
      }

      const adapter = self.adapters.get(adapterId);
      if (adapter && reply) {
        yield* adapter
          .sendMessage(
            { channelId: msg.channelId, replyToMessageId: msg.replyTo },
            { text: reply },
          )
          .pipe(Effect.catchAll(() => Effect.void));
      }

      if (bus && reply) {
        yield* bus.publish({
          _tag: "ChannelMessageSent",
          taskId,
          platform: msg.platform,
          messageId: `local-${Date.now()}`,
          channelId: msg.channelId,
          timestamp: Date.now(),
        } as unknown as AgentEvent);
      }
    }).pipe(Effect.catchAll(() => Effect.void));
  }

  status(): ChannelStatus {
    const adapters: AdapterInfo[] = [...this.adapters.values()].map((a) => ({
      id: a.id,
      connected: true,
      sessionsActive: 0,
    }));
    return {
      adapters,
      activeSessions: 0,
      totalMessagesProcessed: this.totalProcessed,
    };
  }
}

/** Test helper: always allow execution. */
export const alwaysExecutePolicy = (_event: GatewayEvent): Effect.Effect<PolicyDecision, never> =>
  Effect.succeed({ action: "execute", taskDescription: "channel" });
