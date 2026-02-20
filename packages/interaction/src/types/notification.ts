// File: src/types/notification.ts
import { Schema } from "effect";

// ─── Notification Channel ───

export const NotificationChannel = Schema.Literal(
  "in-app", // Dashboard notification
  "callback", // Programmatic callback
  "event-bus", // EventBus from Layer 1
);
export type NotificationChannel = typeof NotificationChannel.Type;

// ─── Notification Priority ───

export const NotificationPriority = Schema.Literal(
  "low",
  "normal",
  "high",
  "urgent",
);
export type NotificationPriority = typeof NotificationPriority.Type;

// ─── Notification ───

export const NotificationSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  channel: NotificationChannel,
  priority: NotificationPriority,
  title: Schema.String,
  body: Schema.String,
  data: Schema.optional(Schema.Unknown),
  createdAt: Schema.DateFromSelf,
  readAt: Schema.optional(Schema.DateFromSelf),
});
export type Notification = typeof NotificationSchema.Type;

// ─── Reporting Config ───

export const ReportingFrequency = Schema.Literal(
  "realtime",
  "milestone",
  "hourly",
  "daily",
);
export type ReportingFrequency = typeof ReportingFrequency.Type;

export const ReportingDetailLevel = Schema.Literal(
  "minimal",
  "summary",
  "detailed",
);
export type ReportingDetailLevel = typeof ReportingDetailLevel.Type;

export const ReportingConfigSchema = Schema.Struct({
  frequency: ReportingFrequency,
  channel: NotificationChannel,
  detail: ReportingDetailLevel,
  streaming: Schema.Boolean,
});
export type ReportingConfig = typeof ReportingConfigSchema.Type;
