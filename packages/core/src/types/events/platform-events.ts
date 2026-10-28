

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
  // ─── Compression coordination (GH #119 + HS-128) ───
  // Curator-as-sole-prompt-author contract has advisors that RECOMMEND
  // compression (dispatcher compress-messages handler, verbosity detector).
  // The applier (curator) side of the recommendation→application chain has
  // no producer yet — `CompressionApplied` was removed until that half is
  // built. Source discriminant lets observers distinguish dispatcher-driven
  // vs detector-driven recommendations without colliding their thresholds.
  | {
      readonly _tag: "CompressionRecommendation";
      readonly taskId: string;
      readonly iteration: number;
      readonly source: "dispatcher" | "verbosity-detector";
      readonly targetTokens: number;
      readonly reason: string;
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
