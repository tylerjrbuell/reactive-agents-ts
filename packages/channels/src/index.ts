/**
 * @reactive-agents/channels — external channel layer (webhooks, bot transports, triggers).
 *
 * Prefer Bot API tokens and HTTPS webhooks over user MTProto clients for Telegram-style integrations.
 */

export * from "./errors.js";
export * from "./adapter.js";
export * from "./combinators.js";
export * from "./types.js";
export * from "./services/trigger-registry.js";
export * from "./services/session-bridge.js";
export * from "./services/channel-service.js";
export * from "./services/gateway-bridge.js";
export * from "./routing/types.js";
export { validateRoutes, validateRoute, wideningChanges } from "./routing/validate.js";
export {
  matchRoute,
  routeMatches,
  groupAllowed,
  decideRouteAccess,
  explainRoute,
  toolExposureFor,
  type AccessVerdict,
  type MatchInput,
} from "./routing/match.js";
export { makeMemoryRouterStore } from "./routing/store.js";
export { makeSqliteRouterStore, openSqliteRouterStore, type SqliteRouterStore, type SqliteRouterStoreOptions } from "./routing/sqlite-store.js";
export {
  InboxError,
  type InboxCounts,
  type InboxEntry,
  type InboxRecovery,
  type InboxSettled,
  type InboxStatus,
  type RouterInbox,
} from "./routing/inbox.js";
export type { InboxEvent, InboxEventType } from "./routing/inbox-tracker.js";
export {
  OutboxError,
  makeMemoryOutbox,
  type OutboxCounts,
  type OutboxEntry,
  type OutboxOptions,
  type OutboxRowInput,
  type OutboxStatus,
  type RouterOutbox,
} from "./routing/outbox.js";
export {
  FollowUpTimers,
  TimerError,
  makeFollowUpTool,
  makeMemoryTimers,
  parseFollowUpDelay,
  type FollowUpLimits,
  type FollowUpPort,
  type FollowUpRequest,
  type FollowUpTimer,
  type FollowUpTool,
  type FollowUpToolParameter,
  type FollowUpToolResult,
  type RouterTimers,
  type TimerBinding,
  type TimerCounts,
  type TimerErrorReason,
  type TimerRow,
  type TimerStatus,
} from "./routing/timers.js";
export {
  makeRouteMeter,
  type RouteMeter,
  type RouteMeterOptions,
  type RouteMeterSnapshot,
  type MeterReservation,
  type MeterRefusal,
} from "./routing/meter.js";
export { makeFileLeases, makeMemoryLeases, defaultLeaseDir, type AccountLeases } from "./routing/lease.js";
export { createChannelRouter, type ChannelRouter, type ChannelRouterOptions } from "./routing/router.js";
export * from "./adapters/webhook.js";
export * from "./adapters/signal.js";
export * from "./adapters/signal-protocol.js";
export * from "./adapters/signal-transport.js";
export * from "./adapters/telegram.js";
export * from "./adapters/telegram-api.js";
export * from "./adapters/telegram-protocol.js";
