/**
 * The hub's default turn acknowledgement for a new route.
 *
 * A Telegram route the owner did not give an `ack` gets `{ source: "model" }`: the agent's own
 * narration or a one-line model call is sent when a turn runs long, with the framework's canned text
 * as the fallback. An explicit `ack` (including `false`, the owner's "off") is never touched, and a
 * webhook route never gets one (the framework refuses the key there). Pure.
 */
import type { RouteSpecInput } from "@reactive-agents/channels";

/** The ack a new Telegram route starts with. */
export const DEFAULT_TELEGRAM_ACK = { source: "model" } as const;

/** `spec` with the platform's default ack added when the owner set none; otherwise `spec` unchanged. */
export const withDefaultAck = (spec: RouteSpecInput, platform: string | undefined): RouteSpecInput =>
  platform === "telegram" && spec.ack === undefined ? { ...spec, ack: { ...DEFAULT_TELEGRAM_ACK } } : spec;
