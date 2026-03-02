import { Schema } from "effect";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const GatewayEventSourceSchema = Schema.Literal(
  "heartbeat",
  "cron",
  "webhook",
  "channel",
  "a2a",
  "state-change",
);
export type GatewayEventSource = typeof GatewayEventSourceSchema.Type;

export const EventPrioritySchema = Schema.Literal(
  "low",
  "normal",
  "high",
  "critical",
);
export type EventPriority = typeof EventPrioritySchema.Type;

export const HeartbeatPolicySchema = Schema.Literal(
  "always",
  "adaptive",
  "conservative",
);
export type HeartbeatPolicy = typeof HeartbeatPolicySchema.Type;

// ─── Gateway Event (universal input envelope) ────────────────────────────────

export interface GatewayEvent {
  readonly id: string;
  readonly source: GatewayEventSource;
  readonly timestamp: Date;
  readonly agentId?: string;
  readonly payload: unknown;
  readonly priority: EventPriority;
  readonly metadata: Record<string, unknown>;
  readonly traceId?: string;
}

// ─── Policy Decision ─────────────────────────────────────────────────────────

export type PolicyDecision =
  | { readonly action: "execute"; readonly taskDescription: string }
  | { readonly action: "queue"; readonly reason: string }
  | { readonly action: "skip"; readonly reason: string }
  | { readonly action: "merge"; readonly mergeKey: string }
  | { readonly action: "escalate"; readonly reason: string };

// ─── Configuration Schemas ───────────────────────────────────────────────────

export const HeartbeatConfigSchema = Schema.Struct({
  intervalMs: Schema.Number,
  policy: Schema.optionalWith(HeartbeatPolicySchema, { default: () => "adaptive" as const }),
  instruction: Schema.optional(Schema.String),
  maxConsecutiveSkips: Schema.optionalWith(Schema.Number, { default: () => 6 }),
});
export type HeartbeatConfig = typeof HeartbeatConfigSchema.Type;

export const CronEntrySchema = Schema.Struct({
  schedule: Schema.String,
  instruction: Schema.String,
  agentId: Schema.optional(Schema.String),
  priority: Schema.optionalWith(EventPrioritySchema, { default: () => "normal" as const }),
  timezone: Schema.optional(Schema.String),
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => true }),
});
export type CronEntry = typeof CronEntrySchema.Type;

export const WebhookConfigSchema = Schema.Struct({
  path: Schema.String,
  adapter: Schema.String,
  secret: Schema.optional(Schema.String),
  events: Schema.optional(Schema.Array(Schema.String)),
});
export type WebhookConfig = typeof WebhookConfigSchema.Type;

export const PolicyConfigSchema = Schema.Struct({
  dailyTokenBudget: Schema.optionalWith(Schema.Number, { default: () => 100_000 }),
  maxActionsPerHour: Schema.optionalWith(Schema.Number, { default: () => 30 }),
  heartbeatPolicy: Schema.optionalWith(HeartbeatPolicySchema, { default: () => "adaptive" as const }),
  mergeWindowMs: Schema.optionalWith(Schema.Number, { default: () => 300_000 }),
  requireApprovalFor: Schema.optional(Schema.Array(Schema.String)),
});
export type PolicyConfig = typeof PolicyConfigSchema.Type;

// ─── Channel Access Configuration ───────────────────────────────────────────

export interface ChannelAccessConfig {
  readonly policy: "allowlist" | "blocklist" | "open";
  readonly allowedSenders?: readonly string[];
  readonly blockedSenders?: readonly string[];
  readonly unknownSenderAction?: "skip" | "escalate";
  readonly replyToUnknown?: string;
}

export const GatewayConfigSchema = Schema.Struct({
  heartbeat: Schema.optional(HeartbeatConfigSchema),
  crons: Schema.optional(Schema.Array(CronEntrySchema)),
  webhooks: Schema.optional(Schema.Array(WebhookConfigSchema)),
  policies: Schema.optional(PolicyConfigSchema),
  port: Schema.optionalWith(Schema.Number, { default: () => 3000 }),
});
export type GatewayConfig = typeof GatewayConfigSchema.Type;

// ─── Gateway State (tracked by Ref, zero LLM cost) ──────────────────────────

export interface GatewayState {
  readonly isRunning: boolean;
  readonly lastExecutionAt: Date | null;
  readonly consecutiveHeartbeatSkips: number;
  readonly tokensUsedToday: number;
  readonly actionsThisHour: number;
  readonly hourWindowStart: Date;
  readonly dayWindowStart: Date;
  readonly pendingEvents: readonly GatewayEvent[];
}

export const initialGatewayState = (): GatewayState => ({
  isRunning: false,
  lastExecutionAt: null,
  consecutiveHeartbeatSkips: 0,
  tokensUsedToday: 0,
  actionsThisHour: 0,
  hourWindowStart: new Date(),
  dayWindowStart: new Date(),
  pendingEvents: [],
});

// ─── Gateway Stats (for dashboard / events) ─────────────────────────────────

export interface GatewayStats {
  readonly heartbeatsFired: number;
  readonly heartbeatsSkipped: number;
  readonly webhooksReceived: number;
  readonly webhooksProcessed: number;
  readonly webhooksMerged: number;
  readonly cronsExecuted: number;
  readonly channelMessages: number;
  readonly totalTokensUsed: number;
  readonly actionsSuppressed: number;
  readonly actionsEscalated: number;
}
