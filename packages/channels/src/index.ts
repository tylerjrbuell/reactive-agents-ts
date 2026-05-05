/**
 * @reactive-agents/channels — external channel layer (webhooks, bot transports, triggers).
 *
 * Prefer Bot API tokens and HTTPS webhooks over user MTProto clients for Telegram-style integrations.
 */

export * from "./errors.js";
export * from "./types.js";
export * from "./services/trigger-registry.js";
export * from "./services/session-bridge.js";
export * from "./services/channel-service.js";
export * from "./adapters/webhook.js";
