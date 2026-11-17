/**
 * Which route settings apply to which channel kind. Pure.
 *
 * One table instead of `platform === "webhook"` checks scattered across the route editor, the wire
 * builder and the route list. A messaging channel has senders, conversations, acknowledgements and
 * batching; a webhook is an inbound HTTP trigger whose access is its signing secret and whose reply
 * is the HTTP response, so none of those apply. The framework refuses the access, ack, batching and
 * mid-run fields on a webhook route (`validateRoutes`); the rest are hidden because they have no
 * meaning there.
 */
import type { ChannelKind } from "./channel-kind-copy.js";

/** The route settings a kind supports. */
export interface RouteCapabilities {
  /** Direct messages vs groups. */
  readonly conversation: boolean;
  /** Mention, command and keyword triggers. */
  readonly trigger: boolean;
  /** Owners, allow, deny, open and sender tools. */
  readonly senderAccess: boolean;
  /** The "working on it" acknowledgement. */
  readonly ack: boolean;
  /** Burst batching and mid-run pacing. */
  readonly batching: boolean;
  /** `/new`-style conversation reset commands. */
  readonly reset: boolean;
  /** Run time limit. */
  readonly turnLimit: boolean;
  /** Telling the sender when a turn fails. */
  readonly failureNotice: boolean;
  /** The per-sender hourly cap. */
  readonly perSenderCap: boolean;
}

const MESSAGING: RouteCapabilities = {
  conversation: true,
  trigger: true,
  senderAccess: true,
  ack: true,
  batching: true,
  reset: true,
  turnLimit: true,
  failureNotice: true,
  perSenderCap: true,
};

/** Capabilities per kind. */
export const ROUTE_CAPABILITIES: Readonly<Record<ChannelKind, RouteCapabilities>> = {
  telegram: MESSAGING,
  signal: MESSAGING,
  webhook: {
    conversation: false,
    trigger: false,
    senderAccess: false,
    ack: false,
    batching: false,
    reset: false,
    // The run time limit still applies to a webhook run; the failure notice does not (the reply is the HTTP response).
    turnLimit: true,
    failureNotice: false,
    perSenderCap: false,
  },
};

/** Capabilities of `platform`; an unknown or missing platform is treated as a messaging channel. */
export function routeCapabilities(platform: string | undefined): RouteCapabilities {
  return platform === "webhook" ? ROUTE_CAPABILITIES.webhook : platform === "signal" ? ROUTE_CAPABILITIES.signal : MESSAGING;
}
