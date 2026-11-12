import type { Effect } from "effect";
import type { ConnectionState } from "./adapter.js";
import type { ChannelConnectionError, ChannelError, ChannelSendError } from "./errors.js";

/**
 * External messaging and webhook types for the channels layer.
 *
 * **Bot-first design:** First-class paths are Bot API + HTTPS webhooks (e.g. Telegram Bot API,
 * Discord gateway events) and similar token-based bots. Adapters normalize provider payloads into
 * {@link InboundMessage}. Full-fidelity user clients (e.g. MTProto / Telethon) may exist as
 * separate MCP or custom adapters but are not the default shape this module optimizes for.
 */

// ── MessageChannel — Bi-Directional Transport ─────────────────────────────

/**
 * Legacy bi-directional transport.
 * @deprecated New adapters implement `ChannelAdapter` (see `./adapter.ts`), which adds typed
 * delivery receipts, honest connection state and a backpressured inbound stream.
 * `ChannelService.registerAdapter` still accepts this shape.
 */
export interface MessageChannel {
  readonly id: string;
  connect(): Effect.Effect<void, ChannelConnectionError>;
  disconnect(): Effect.Effect<void, ChannelConnectionError>;
  sendMessage(target: ChannelTarget, content: MessageContent): Effect.Effect<SendResult, ChannelSendError>;
  onMessage(handler: (msg: InboundMessage) => Effect.Effect<void>): Effect.Effect<ChannelSubscription>;
}

export interface ChannelSubscription {
  unsubscribe(): Effect.Effect<void>;
}

// ── Inbound Message ───────────────────────────────────────────────────────

/**
 * Normalized inbound message as read by triggers and the session bridge.
 * Adapters emit `InboundEnvelope`; `ChannelService` converts it to this shape.
 */
export interface InboundMessage {
  readonly id: string;
  /**
   * Transport identifier for routing and policy. Prefer explicit bot-oriented ids where applicable,
   * e.g. `discord`, `telegram-bot` (Bot API webhooks / long-poll), `signal`, rather than overloading
   * a single `telegram` label for both bot-token and user-session transports.
   */
  readonly platform: string;
  /** Channel, DM, thread, or chat id in the provider’s namespace. */
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: string;
  readonly attachments?: Attachment[];
  readonly replyTo?: string;
  /**
   * Provider-specific fields (webhook raw ids, bot username, etc.). Keep small; do not store secrets.
   */
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
}

// ── Outbound ──────────────────────────────────────────────────────────────

export interface ChannelTarget {
  readonly channelId: string;
  readonly threadId?: string;
  readonly replyToMessageId?: string;
}

export interface MessageContent {
  readonly text: string;
  readonly format?: "plain" | "markdown";
  readonly embeds?: EmbedContent[];
  readonly attachments?: Attachment[];
}

export interface EmbedContent {
  readonly title?: string;
  readonly description?: string;
  readonly color?: string;
  readonly fields?: ReadonlyArray<{ name: string; value: string; inline?: boolean }>;
  readonly footer?: string;
}

export type Attachment =
  | {
      readonly type: "url";
      readonly filename: string;
      readonly contentType: string;
      readonly url: string;
    }
  | {
      readonly type: "binary";
      readonly filename: string;
      readonly contentType: string;
      readonly data: Uint8Array;
    };

/** @deprecated Use `DeliveryReceipt`. */
export interface SendResult {
  readonly messageId: string;
  readonly timestamp: Date;
}

// ── External Identity ─────────────────────────────────────────────────────

export interface ExternalIdentity {
  readonly platform: string;
  readonly userId: string;
  readonly displayName?: string;
  readonly metadata?: Record<string, unknown>;
}

// ── Triggers ──────────────────────────────────────────────────────────────

export interface TriggerDefinition {
  readonly id: string;
  readonly name: string;
  readonly match: TriggerMatchCondition;
  readonly agent: TriggerAgentConfig;
  readonly response?: ResponseRouting;
  readonly lifecycle?: AgentLifecycle;
  readonly permissions?: TriggerPermissions;
}

export type TriggerMatchCondition =
  | { readonly type: "mention" }
  | { readonly type: "slash_command"; readonly command: string }
  | { readonly type: "keyword"; readonly patterns: readonly string[] }
  | { readonly type: "reaction"; readonly emoji: string }
  | { readonly type: "webhook"; readonly path: string }
  | { readonly type: "custom"; readonly evaluate: (msg: InboundMessage) => boolean };

export interface TriggerAgentConfig {
  readonly persona?: {
    name?: string;
    role?: string;
    background?: string;
    instructions?: string;
    tone?: string;
  };
  readonly tools?: readonly string[];
  readonly reasoning?: "reactive" | "plan-execute" | "tree-of-thought" | "reflexion" | "adaptive";
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxIterations?: number;
  readonly derive?: (msg: InboundMessage) => Partial<TriggerAgentConfig>;
}

export interface ResponseRouting {
  readonly mode: "trigger_thread" | "dm" | "channel" | "callback";
  readonly channelId?: string;
  readonly callbackUrl?: string;
}

export type AgentLifecycle =
  | { readonly type: "single_response" }
  | { readonly type: "conversation"; readonly idleTimeoutMs?: number }
  | { readonly type: "persistent" }
  | { readonly type: "ttl"; readonly durationMs: number };

export interface TriggerPermissions {
  readonly allowedUsers?: readonly string[];
  readonly allowedRoles?: readonly string[];
  readonly deniedUsers?: readonly string[];
}

// ── Status ────────────────────────────────────────────────────────────────

export interface ActiveSession {
  readonly sessionId: string;
  readonly platform: string;
  readonly externalUserId: string;
  readonly externalChannelId: string;
  readonly state: "active" | "idle" | "ended";
  readonly messageCount: number;
  readonly lastActiveAt: Date;
}

export interface AdapterInfo {
  readonly id: string;
  /** True only when the adapter reports `ConnectionState.status === "connected"`. */
  readonly connected: boolean;
  /** @deprecated Always 0; use {@link ChannelStatus.activeSessions}. */
  readonly sessionsActive: number;
  /** Latest reported connection state. */
  readonly state: ConnectionState;
  /** Outbound sends that failed since registration (each also published as a delivery-failed event). */
  readonly deliveryFailures: number;
  /** Most recent delivery failure, if any. */
  readonly lastError?: ChannelError;
}

export interface ChannelStatus {
  readonly adapters: readonly AdapterInfo[];
  /** Live chat sessions held by the session bridge. */
  readonly activeSessions: number;
  readonly totalMessagesProcessed: number;
}

// ── Session Bridge ────────────────────────────────────────────────────────

/**
 * Injected by the runtime so channels never depends on `@reactive-agents/runtime`.
 * Implementations wire real `agent.session()` chat here (including bot-specific system prompts/tools).
 */
export type AgentSessionFactory = (
  agentConfig: TriggerAgentConfig | undefined,
  sessionId: string,
) => Promise<{ chat: (message: string) => Promise<{ message: string; tokens?: number }> }>;

export interface SessionBridgeResolveParams {
  readonly identity: ExternalIdentity;
  readonly channelId: string;
  readonly agentConfig?: TriggerAgentConfig;
  readonly lifecycle?: AgentLifecycle;
}

// ── Channels Config (for builder) ─────────────────────────────────────────

export interface ChannelsConfig {
  readonly adapters: readonly MessageChannel[];
  readonly triggers?: readonly TriggerDefinition[];
  readonly defaultAgent?: TriggerAgentConfig;
  readonly sessions?: {
    readonly compactionThreshold?: number;
    readonly idleTimeoutMs?: number;
  };
}
