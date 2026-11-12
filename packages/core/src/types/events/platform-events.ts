

/** Gateway, reactive-intelligence, compression, channel and custom events. */
export type PlatformAgentEvent =
  // ─── Gateway events (from @reactive-agents/gateway) ───
  | {
      /**
       * Gateway started and is listening for events.
       * Fired when GatewayService.start() completes initialization.
       */
      readonly _tag: "GatewayStarted";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source names that are active (e.g., ["heartbeat", "cron", "webhook"]) */
      readonly sources: readonly string[];
      /** Policy names applied to this gateway (e.g., ["daily-token-budget", "rate-limit"]) */
      readonly policies: readonly string[];
      /** Unix timestamp in milliseconds when gateway started */
      readonly timestamp: number;
    }
  | {
      /**
       * An external event was received by the gateway.
       * Fired when any event source delivers an event to the input router.
       */
      readonly _tag: "GatewayEventReceived";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that produced this event (e.g., "heartbeat", "webhook", "cron") */
      readonly source: string;
      /** Unique event identifier for correlation */
      readonly eventId: string;
      /** Unix timestamp in milliseconds when event was received */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action was initiated by the gateway.
       * Fired when the gateway dispatches a task to the agent based on a received event.
       */
      readonly _tag: "ProactiveActionInitiated";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that triggered this action */
      readonly source: string;
      /** Description of the task the agent will execute */
      readonly taskDescription: string;
      /** Unix timestamp in milliseconds when action was initiated */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action completed.
       * Fired after the agent finishes executing a gateway-initiated task.
       */
      readonly _tag: "ProactiveActionCompleted";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that triggered the original action */
      readonly source: string;
      /** True if the action executed successfully */
      readonly success: boolean;
      /** Total tokens consumed by this action */
      readonly tokensUsed: number;
      /** Total duration in milliseconds */
      readonly durationMs: number;
      /** Unix timestamp in milliseconds when action completed */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action was suppressed by policy.
       * Fired when the policy engine blocks an event from triggering an action.
       */
      readonly _tag: "ProactiveActionSuppressed";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that produced the suppressed event */
      readonly source: string;
      /** Human-readable reason for suppression */
      readonly reason: string;
      /** Policy name that triggered the suppression */
      readonly policy: string;
      /** Event identifier that was suppressed */
      readonly eventId: string;
      /** Unix timestamp in milliseconds when suppression occurred */
      readonly timestamp: number;
    }
  | {
      /**
       * A heartbeat tick was skipped.
       * Fired when the heartbeat scheduler decides to skip based on policy (adaptive/conservative).
       */
      readonly _tag: "HeartbeatSkipped";
      /** Agent identifier */
      readonly agentId: string;
      /** Reason for skipping (e.g., "no_changes", "rate_limited", "conservative_policy") */
      readonly reason: string;
      /** Number of consecutive skips including this one */
      readonly consecutiveSkips: number;
      /** Unix timestamp in milliseconds when skip occurred */
      readonly timestamp: number;
    }
  | {
      /**
       * A budget (token or action) was exhausted.
       * Fired when policy enforcement detects that a budget limit has been reached.
       */
      readonly _tag: "BudgetExhausted";
      /** Agent identifier */
      readonly agentId: string;
      /** Type of budget exhausted (e.g., "daily-tokens", "hourly-actions") */
      readonly budgetType: string;
      /** Budget limit that was reached */
      readonly limit: number;
      /** Amount used when limit was reached */
      readonly used: number;
      /** Unix timestamp in milliseconds when budget was exhausted */
      readonly timestamp: number;
    }
  // ─── Reactive Intelligence ───
  | {
      readonly _tag: "EntropyScored";
      readonly taskId: string;
      readonly iteration: number;
      readonly composite: number;
      readonly sources: {
        readonly token: number | null;
        readonly structural: number;
        readonly semantic: number | null;
        readonly behavioral: number;
        readonly contextPressure: number;
      };
      readonly trajectory: {
        readonly derivative: number;
        readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
        readonly momentum: number;
      };
      readonly confidence: "high" | "medium" | "low";
      readonly modelTier: "frontier" | "local" | "unknown";
      readonly iterationWeight: number;
      /** Model identifier that produced this entropy score, when known */
      readonly modelId?: string;
    }
  | {
      readonly _tag: "ContextWindowWarning";
      readonly taskId: string;
      readonly modelId: string;
      readonly utilizationPct: number;
      readonly compressionHeadroom: number;
      readonly atRiskSections: readonly string[];
    }
  | {
      readonly _tag: "CalibrationDrift";
      readonly taskId: string;
      readonly modelId: string;
      readonly expectedMean: number;
      readonly observedMean: number;
      readonly deviationSigma: number;
    }
  | {
      readonly _tag: "ReactiveDecision";
      readonly taskId: string;
      readonly iteration: number;
      readonly decision: "early-stop" | "branch" | "compress" | "switch-strategy" | "attribute";
      readonly reason: string;
      readonly entropyBefore: number;
      readonly entropyAfter?: number;
      /** Controller-supplied confidence (0-1), e.g. switch-strategy's loop-score
       *  headroom. Preferred by trace/normalize.ts over the entropyBefore/After
       *  delta formula, which switch-strategy decisions never carry. */
      readonly confidence?: number;
    }
  // ─── Channel / messaging events ───
  | {
      /**
       * An incoming message was received from a messaging channel.
       * Fired by ToolService when an MCP server sends a notifications/message notification.
       * For Bot API / webhook transports, prefer emitting the normalized shape used by `@reactive-agents/channels`
       * (`InboundMessage` + `telegram-bot`-style platform ids) once wired.
       */
      readonly _tag: "ChannelMessageReceived";
      /** Sender identifier (phone number, user ID, etc.) */
      readonly sender: string;
      /** Messaging platform name (e.g., "signal", "telegram") */
      readonly platform: string;
      /** Message text content */
      readonly message: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
      /** MCP server name that received the message */
      readonly mcpServer: string;
      /** Optional group identifier */
      readonly groupId?: string;
      /**
       * Id of the `ChannelAdapter` that received the message. Absent for MCP-notification
       * sourced messages, which have no adapter.
       */
      readonly adapterId?: string;
      /**
       * Where the message arrived, in adapter-neutral terms. Absent for MCP-notification
       * sourced messages.
       */
      readonly conversation?: {
        /** Platform channel / chat id the message arrived in. */
        readonly channelId: string;
        /** Thread id within the channel. Absent when the platform has no thread or the message is not in one. */
        readonly threadId?: string;
        /** True when the conversation has more than two participants (group chat, public channel). */
        readonly isGroup: boolean;
      };
    }
  | {
      /**
       * An outbound delivery through a channel adapter failed. Typed counterpart of the
       * delivery receipt: carries a classification only. It never carries credentials,
       * request bodies, or the underlying cause object; look at adapter logs for those.
       */
      readonly _tag: "ChannelDeliveryFailed";
      /** Task the delivery belonged to. Absent when the send was not made inside a task (e.g. a workflow Deliver node outside a run). */
      readonly taskId?: string;
      /** Id of the adapter whose send failed. */
      readonly adapterId: string;
      /** Failure class: auth, rate_limited, not_found, forbidden, too_large, unsupported, network, or unknown. */
      readonly kind:
        | "auth"
        | "rate_limited"
        | "not_found"
        | "forbidden"
        | "too_large"
        | "unsupported"
        | "network"
        | "conflict"
        | "unknown";
      /** True when retrying the same send may succeed (e.g. rate_limited, network). */
      readonly retryable: boolean;
      /** Milliseconds to wait before retrying, when the platform said so. Absent otherwise. */
      readonly retryAfterMs?: number;
      /** Conversation the send targeted. Absent when it was not known. */
      readonly conversationId?: string;
    }
  // ─── Channel router events (never carry message text or secrets) ───
  | {
      /** The channel router matched an inbound message to an enabled route and its access check allowed it. */
      readonly _tag: "ChannelRouteMatched";
      /** Id of the matched route. */
      readonly routeId: string;
      /** Id of the channel (adapter) the message arrived on. */
      readonly channelId: string;
      /** Role the sender resolved to on this route (e.g. "owner", "member"). */
      readonly role: string;
      /** True when produced by a router simulation (dry run); nothing was sent to the platform. */
      readonly simulated?: boolean;
    }
  | {
      /** A route matched but its access policy denied the sender. */
      readonly _tag: "ChannelRouteDenied";
      /** Id of the route that denied the sender. */
      readonly routeId: string;
      /** Id of the channel (adapter) the message arrived on. */
      readonly channelId: string;
      /** True when produced by a router simulation (dry run). */
      readonly simulated?: boolean;
    }
  | {
      /** No enabled route matched an inbound message. */
      readonly _tag: "ChannelUnrouted";
      /** Id of the channel (adapter) the message arrived on. */
      readonly channelId: string;
      /** True when produced by a router simulation (dry run). */
      readonly simulated?: boolean;
    }
  | {
      /** An agent turn started for a routed message. */
      readonly _tag: "ChannelTurnStarted";
      /** Id of the route the turn runs under. */
      readonly routeId: string;
      /** Role the sender resolved to on this route. */
      readonly role: string;
      /** True when produced by a router simulation (dry run). */
      readonly simulated?: boolean;
    }
  | {
      /** A routed agent turn finished, successfully or not. */
      readonly _tag: "ChannelTurnCompleted";
      /** Id of the route the turn ran under. */
      readonly routeId: string;
      /** Role the sender resolved to on this route. */
      readonly role: string;
      /** True when the turn produced a reply; false when it failed or timed out. */
      readonly ok: boolean;
      /** Failure reason (e.g. "turn_timeout"). Absent when `ok` is true. */
      readonly reason?: string;
      /** Id of the agent that ran the turn. Absent when the router did not know it. */
      readonly agentId?: string;
      /** Id of the run the turn produced. Absent when the turn failed or the agent reported none. */
      readonly runId?: string;
      /** Total tokens the turn used. Absent when the agent reported none. */
      readonly tokens?: number;
      /** Cost of the turn in USD. Absent when the agent reported none. */
      readonly costUsd?: number;
      /** True when produced by a router simulation (dry run). */
      readonly simulated?: boolean;
    }
  | {
      /** A routed message was dropped before an agent turn ran. */
      readonly _tag: "ChannelTurnDropped";
      /** Id of the route that dropped the message. */
      readonly routeId: string;
      /**
       * Why: backpressure (conversation queue full), rate (turn rate limit), budget (route budget spent),
       * group (group messages not allowed), echo (the bot's own message), disabled-channel (channel is off).
       */
      readonly reason: "backpressure" | "rate" | "budget" | "group" | "echo" | "disabled-channel";
      /** True when produced by a router simulation (dry run). */
      readonly simulated?: boolean;
    }
  | {
      /** Ownership of a channel's platform account changed, e.g. another consumer took it over. */
      readonly _tag: "ChannelOwnershipChanged";
      /** Id of the channel (adapter) whose ownership changed. */
      readonly channelId: string;
      /** New state: "conflict" means another consumer owns the account and the channel was stopped. */
      readonly state: "conflict";
    }
  | {
      /** Outbound message was sent on a channel (bots, webhooks, MCP-backed transports). */
      readonly _tag: "ChannelMessageSent";
      readonly taskId: string;
      readonly platform: string;
      readonly messageId: string;
      readonly channelId: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "TriggerFired";
      readonly taskId: string;
      readonly triggerId: string;
      readonly triggerName: string;
      readonly platform: string;
      readonly sessionId: string;
      readonly timestamp: number;
    }
  // ─── Custom/extension events ───
  | {
      /**
       * A custom application-defined event.
       * Fired by user code extending the framework with custom observability.
       */
      readonly _tag: "Custom";
      /** Custom event type identifier */
      readonly type: string;
      /** Arbitrary custom payload */
      readonly payload: unknown;
    };
