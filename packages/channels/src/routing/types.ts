import { Data, Schema } from "effect";
import type { Effect, Scope } from "effect";
import type { ChannelIdentity, DeliveryReceipt } from "../adapter.js";
import type { ChannelError } from "../errors.js";
import type { Attachment, InboundMessage } from "../types.js";
import type { AckPortResult } from "./ack.js";

/**
 * Channel routing types: a Route is one flat rule (match an inbound conversation, pick a target
 * agent, say who may talk and what a stranger may do). Spec:
 * `wiki/Architecture/Design-Specs/2026-11-12-channel-routing.md`.
 */

// ── Schemas ───────────────────────────────────────────────────────────────

/** What a non-owner sender's agent may do. Decided when the agent is BUILT, never per turn. */
export const ToolExposure = Schema.Union(
  Schema.TaggedStruct("ReadOnly", {}),
  Schema.TaggedStruct("AgentDefault", {}),
  Schema.TaggedStruct("Allowlist", { tools: Schema.Array(Schema.String) }),
);
/** See {@link ToolExposure}. */
export type ToolExposure = Schema.Schema.Type<typeof ToolExposure>;

/** Which inbound conversations a route claims. */
export const RouteMatch = Schema.Struct({
  /** Adapter id the route listens on; `"*"` matches every channel. */
  channelId: Schema.String,
  conversation: Schema.optional(Schema.Literal("dm", "group")),
  /** Platform conversation ids (chat ids). */
  conversationIds: Schema.optional(Schema.Array(Schema.String)),
  when: Schema.optional(
    Schema.Union(
      Schema.TaggedStruct("Mention", {}),
      Schema.TaggedStruct("Command", { name: Schema.String }),
      Schema.TaggedStruct("Keyword", { patterns: Schema.Array(Schema.String) }),
    ),
  ),
});
/** See {@link RouteMatch}. */
export type RouteMatch = Schema.Schema.Type<typeof RouteMatch>;

/**
 * Turn acknowledgement: what the router does while a slow turn runs. Deterministic and zero-token;
 * the text is fixed config, never agent output and never built from sender text.
 */
export const RouteAck = Schema.Struct({
  /** Ms a turn must still be running before the acknowledgement message is sent. Default 4000. */
  afterMs: Schema.optional(Schema.Number),
  /** The acknowledgement text, or several to rotate through. Default `"On it..."`. */
  text: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
  /** Show a typing indicator from the start of the turn, when the adapter supports it. Default true. */
  typing: Schema.optional(Schema.Boolean),
  /**
   * Where the message comes from. `"canned"` (default): the fixed `text`. `"model"`: the agent's own
   * pre-tool narration if the turn already produced some, else the session's optional `acknowledge`
   * port, else the canned text. The router never calls a model itself.
   */
  source: Schema.optional(Schema.Literal("canned", "model")),
  /** With `source: "model"`: ms the `acknowledge` port may take before the canned text is used. 1..30 000, default 12 000. */
  modelTimeoutMs: Schema.optional(Schema.Number),
});
/** See {@link RouteAck}. */
export type RouteAck = Schema.Schema.Type<typeof RouteAck>;

/**
 * One route. Access is flat and fail-closed: `allow` / `deny` / `owners` hold `platform:userId`
 * keys, `open` lets anyone talk (and requires cost and turn caps, see `validateRoutes`).
 */
export const RouteSpec = Schema.Struct({
  id: Schema.String,
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  /** Lower runs first; ties keep declaration order. */
  priority: Schema.optionalWith(Schema.Number, { default: () => 100 }),
  match: RouteMatch,
  target: Schema.Struct({ agentId: Schema.String }),
  /** `per-conversation` keeps history per (route, role, conversation); `stateless` is a fresh run per message. */
  session: Schema.optionalWith(Schema.Literal("per-conversation", "stateless"), {
    default: () => "per-conversation" as const,
  }),
  allow: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  deny: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  owners: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  open: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  senderTools: Schema.optionalWith(ToolExposure, { default: () => ({ _tag: "ReadOnly" as const }) }),
  /** Fixed text sent to a sender the allowlist denied. Never agent output. */
  deniedReply: Schema.optional(Schema.String),
  groups: Schema.optionalWith(Schema.Literal("mention-only", "off"), { default: () => "mention-only" as const }),
  maxIterations: Schema.optional(Schema.Number),
  turnTimeoutMs: Schema.optionalWith(Schema.Number, { default: () => 120_000 }),
  maxTurnsPerSenderPerHour: Schema.optional(Schema.Number),
  maxTurnsPerHour: Schema.optional(Schema.Number),
  maxCostPerDayUsd: Schema.optional(Schema.Number),
  /**
   * Acknowledge a slow turn before the final reply, like a chat: a typing indicator at once and one
   * short message after `afterMs`. Absent or `false`: off (the default).
   */
  ack: Schema.optional(Schema.Union(RouteAck, Schema.Literal(false))),
  /**
   * Messages that, sent by a route owner as the whole text (for example `/new`), end the conversation's
   * session and start a fresh one. Never forwarded to the agent. Default `["/new", "/reset"]`; `[]` disables.
   */
  resetCommands: Schema.optionalWith(Schema.Array(Schema.String), { default: () => ["/new", "/reset"] }),
});
/** A validated route (defaults applied). */
export type RouteSpec = Schema.Schema.Type<typeof RouteSpec>;
/** What callers write: defaults may be omitted. */
export type RouteSpecInput = Schema.Schema.Encoded<typeof RouteSpec>;

/** Per-sender turn cap for routes that do not set one (conversational pace, shown in status). */
export const DEFAULT_MAX_TURNS_PER_SENDER_PER_HOUR = 6;
/** Pending turns (running + waiting) allowed per (route, role, conversation) before overflow. */
export const DEFAULT_CONVERSATION_QUEUE = 5;

// ── Errors ────────────────────────────────────────────────────────────────

/** Why a routing operation failed. */
export type RoutingErrorReason =
  | "invalid_route"
  | "unknown_channel"
  | "channel_start_failed"
  | "confirmation_required"
  | "resolve_failed"
  | "turn_failed"
  | "turn_timeout";

/** Typed routing failure. `message` carries classification only, never message text or secrets. */
export class RoutingError extends Data.TaggedError("RoutingError")<{
  readonly reason: RoutingErrorReason;
  readonly message: string;
  readonly routeId?: string;
  readonly channelId?: string;
  readonly cause?: unknown;
}> {}

/** A second owner tried to open an account that is already open. Fails closed, never shares. */
export class ChannelAlreadyOwned extends Data.TaggedError("ChannelAlreadyOwned")<{
  readonly channelId: string;
  readonly ownerPid: number;
  /** Epoch ms the current owner took the lease. */
  readonly since: number;
}> {}

// ── Agent resolution port ─────────────────────────────────────────────────

/** Modality-neutral turn content. */
export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "attachment"; readonly attachment: Attachment };

/**
 * Approval of a risky tool call over a channel. This slice ships a fail-closed port: nothing is
 * approvable until the approval phase lands.
 */
export interface ApprovalPort {
  readonly request: (summary: string) => Effect.Effect<"approved" | "denied">;
}

/** One inbound turn handed to a routed session. Sender text is user-role content only. */
export interface RoutedTurn {
  /** Sender text: user role only, never concatenated into a system prompt. */
  readonly text: string;
  readonly parts: ReadonlyArray<ContentPart>;
  readonly sender: ChannelIdentity;
  readonly approval: ApprovalPort;
  /** The normalized inbound message (conversation, thread, reply-to, metadata). */
  readonly message: InboundMessage;
  readonly taskId: string;
  /**
   * Present only on routes with `ack.source: "model"`. A resolver calls it with the agent's own
   * pre-tool narration text (for example the text it wrote before its first tool call). The router
   * uses the latest text pushed before the ack delay as the ack, sanitizes it, and drops anything
   * pushed after the ack went out. Never throws; text is never recorded as history by the router.
   */
  readonly onProgress?: (text: string) => void;
}

/** The agent's answer to one turn. */
export interface RoutedReply {
  readonly text: string;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly runId?: string;
  /** Id of the agent that ran the turn, when the resolver knows it. */
  readonly agentId?: string;
}

/** A live conversation with one (route, role) agent. */
export interface RoutedSession {
  readonly send: (turn: RoutedTurn) => Effect.Effect<RoutedReply, RoutingError>;
  /**
   * Optional. With `ack.source: "model"` the router calls this once, started with the turn
   * (concurrent with `send`), and sends the text as the acknowledgement unless narration exists.
   * Text only, one short line, must not touch the session history of the running turn. At
   * `ack.afterMs` the router uses the result if ready, else waits up to `ack.modelTimeoutMs`
   * from `afterMs`, then falls back to the canned text. Return a bare string, or
   * `{ text, fallbackReason }` to say why the text is unusable (`empty`, `thinking_only`, `error`);
   * the router reports it on `ChannelTurnAcknowledged.ackFallbackReason` (it records a timeout itself).
   */
  readonly acknowledge?: (turn: RoutedTurn) => Effect.Effect<AckPortResult, never>;
  /**
   * Optional. Called when a route owner sends a reset command (`/new`), before `close`. A resolver that
   * keeps conversation history outside the session object (a chat store keyed by `conversationKey`)
   * must clear it here, so the next `open` for the same key starts empty and a restart cannot bring the
   * old history back. A failure is reported to the sender and the session is kept.
   */
  readonly reset?: Effect.Effect<void, RoutingError>;
  readonly close: Effect.Effect<void>;
}

/** What the resolver needs to build the right agent. */
export interface OpenSessionRequest {
  readonly routeId: string;
  readonly role: "owner" | "sender";
  readonly target: RouteSpec["target"];
  readonly toolExposure: ToolExposure;
  readonly conversationKey: string;
  readonly stateless: boolean;
}

/**
 * Port 1: turns a route target into a session.
 *
 * Build a DISTINCT agent per (routeId, role) with that role's tool surface applied at
 * construction (for example `.withTools({ allowedTools })`). Histories are never shared across
 * roles. The router resolves the role from `owners` membership before calling `open`.
 */
export interface AgentResolver {
  readonly open: (req: OpenSessionRequest) => Effect.Effect<RoutedSession, RoutingError, Scope.Scope>;
}

// ── Store port ────────────────────────────────────────────────────────────

/** Port 2: routes, seen message ids and rate counters. In-memory by default. */
export interface RouterStore {
  /** True when counters and seen ids survive a restart (this slice only ships in-memory). */
  readonly durable: boolean;
  readonly getRoutes: Effect.Effect<ReadonlyArray<RouteSpec>>;
  readonly setRoutes: (routes: ReadonlyArray<RouteSpec>) => Effect.Effect<void>;
  /** Record a platform message id. True the first time, false on every repeat. */
  readonly markSeen: (key: string) => Effect.Effect<boolean>;
  /** Count one turn in a sliding window. True when it fits under `limit`, false when refused. */
  readonly takeTurn: (bucket: string, limit: number, windowMs: number) => Effect.Effect<boolean>;
}

// ── Outcomes ──────────────────────────────────────────────────────────────

/** Role of a sender on a route. */
export type RouteRole = "owner" | "sender";

/** Why a message was dropped before reaching an agent. */
export type DropReason = "echo" | "group" | "rate" | "backpressure" | "disabled-channel" | "budget";

/** What happened to one inbound message. */
export type RouteOutcome =
  | {
      readonly _tag: "Answered";
      readonly routeId: string;
      readonly role: RouteRole;
      readonly reply: RoutedReply;
      readonly receipt?: DeliveryReceipt;
      readonly deliveryError?: ChannelError;
    }
  | { readonly _tag: "Failed"; readonly routeId: string; readonly role: RouteRole; readonly error: RoutingError }
  | { readonly _tag: "Unrouted" }
  | { readonly _tag: "Denied"; readonly routeId: string; readonly reason: string }
  | { readonly _tag: "Duplicate" }
  | { readonly _tag: "Dropped"; readonly reason: DropReason; readonly routeId?: string };

/** Pure answer to "why did / didn't it answer", without running anything. */
export interface RouteExplanation {
  readonly decision: "unrouted" | "denied" | "dropped-group" | "allowed";
  readonly routeId?: string;
  readonly role?: RouteRole;
  readonly toolExposure?: ToolExposure;
  readonly reason: string;
}

/** Live router state for UIs and tests. */
export interface RouterStatus {
  readonly channels: ReadonlyArray<{
    readonly id: string;
    readonly platform: string;
    readonly connected: boolean;
    /** True when the platform reported another consumer owns the account; the channel was stopped. */
    readonly conflict: boolean;
    readonly messagesReceived: number;
    readonly messagesSent: number;
    readonly deliveryFailures: number;
  }>;
  readonly routes: number;
  readonly unrouted: number;
  readonly dropped: Readonly<Record<DropReason, number>>;
  readonly activeSessions: number;
  /** False means dedupe and rate counters reset on restart. */
  readonly durableStore: boolean;
}
