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
export * from "./adapters/webhook.js";
export * from "./adapters/signal.js";
export * from "./adapters/signal-protocol.js";
export * from "./adapters/signal-transport.js";
export * from "./adapters/telegram.js";
export * from "./adapters/telegram-api.js";
export * from "./adapters/telegram-protocol.js";
