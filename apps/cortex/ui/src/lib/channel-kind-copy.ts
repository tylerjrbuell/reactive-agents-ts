/**
 * The words every channel surface uses, keyed by channel kind. Pure.
 *
 * A messaging channel (Telegram, Signal) talks about senders, messages and chats. A webhook is an
 * inbound HTTP trigger: it talks about requests, callers and a signing secret, and never uses the
 * messaging vocabulary. Components read their copy from here instead of inlining it, so a webhook
 * card, route row or test panel cannot drift back into "sender" or "Telegram" wording.
 * `channel-kind-copy.test.ts` fails when webhook copy contains a messaging word or a kind lacks a key.
 */

/** The adapters Cortex configures. */
export type ChannelKind = "telegram" | "signal" | "webhook";

/** The words one kind uses. Every kind defines every key. */
export interface ChannelKindCopy {
  readonly label: string;
  /** One line of what it is and what it needs. */
  readonly blurb: string;
  /** The single credential the kind needs. */
  readonly credential: { readonly field: string; readonly label: string; readonly hint: string; readonly placeholder: string };
  /** Example caller key for the test panel (`<platform>:<id>`). */
  readonly senderExample: string;
  /** Title and lead of the channel's test panel. */
  readonly testTitle: string;
  readonly testLead: string;
  /** What deleting a route does to what used to match it. */
  readonly routeDeleteNote: string;
  /** Shown when the channel has no route. */
  readonly noRouteNote: string;
  /** Route form: memory between turns. */
  readonly sessionLabel: string;
  readonly sessionKeepOption: string;
  readonly sessionFreshOption: string;
  readonly sessionKeepHint: string;
  readonly sessionFreshHint: string;
  /** Route form: the whole-route hourly cap. */
  readonly turnsPerHourLabel: string;
  /** Route editor words. */
  readonly routeIdPlaceholder: string;
  readonly routeIdHint: string;
  readonly channelFieldHint: string;
  readonly agentFieldHint: string;
  readonly agentRequired: string;
  /** Replaces the sender-access fieldset when the kind has none; empty = not used. */
  readonly accessNote: string;
  readonly maxIterationsHint: string;
  /** Run time limit field (the default seconds are appended by the component). */
  readonly turnLimitLegend: string;
  readonly turnLimitLabel: string;
  readonly turnLimitHint: string;
  readonly turnLimitMin: string;
  /** Route list: the clause naming what the route takes, and the access badge. */
  readonly routeScope: string;
  readonly accessBadge: string;
  /** Live counters on the channel card. */
  readonly inCounter: string;
  readonly outCounter: string;
}

/** Copy for each kind, in display order. */
export const CHANNEL_KIND_COPY: Readonly<Record<ChannelKind, ChannelKindCopy>> = {
  telegram: {
    label: "Telegram",
    blurb: "A bot made with BotFather. Cortex polls Telegram, so no public URL is needed.",
    credential: { field: "token", label: "Bot token", hint: "From @BotFather (/newbot). Saved encrypted; never shown again.", placeholder: "123456789:AA..." },
    senderExample: "telegram:123456789",
    testTitle: "Send test message",
    testLead: "Try a message as a sender and see which route takes it, with which tools, or why it is refused. Nothing is sent to the platform.",
    routeDeleteNote: "Messages that matched it fall through to the next route, or go unanswered.",
    noRouteNote: "A channel with no route answers nobody. Route it to an agent.",
    sessionLabel: "Memory between messages",
    sessionKeepOption: "Keep each conversation",
    sessionFreshOption: "Fresh run per message",
    sessionKeepHint: "The agent remembers each conversation.",
    sessionFreshHint: "Every message is a fresh run.",
    turnsPerHourLabel: "Turns per hour",
    routeIdPlaceholder: "support-dm",
    routeIdHint: "A short name, like support-dm. It cannot change later.",
    channelFieldHint: "The account the message arrives on.",
    agentFieldHint: "The saved agent that answers.",
    agentRequired: "Pick the agent that answers.",
    accessNote: "",
    maxIterationsHint: "Per turn. Empty uses the agent's own limit.",
    turnLimitLegend: "When a turn takes too long or fails",
    turnLimitLabel: "Turn limit (seconds)",
    turnLimitHint: "A turn still running after this is stopped and counted as failed. Empty uses",
    turnLimitMin: "Turn limit must be 1 second or more.",
    routeScope: "any conversation",
    accessBadge: "Talk",
    inCounter: "in",
    outCounter: "out",
  },
  signal: {
    label: "Signal",
    blurb: "A registered number reached through signal-cli (a running daemon, or spawned by Cortex).",
    credential: { field: "account", label: "Account number", hint: "The registered number, with country code. Saved encrypted.", placeholder: "+15551234567" },
    senderExample: "signal:+15551234567",
    testTitle: "Send test message",
    testLead: "Try a message as a sender and see which route takes it, with which tools, or why it is refused. Nothing is sent to the platform.",
    routeDeleteNote: "Messages that matched it fall through to the next route, or go unanswered.",
    noRouteNote: "A channel with no route answers nobody. Route it to an agent.",
    sessionLabel: "Memory between messages",
    sessionKeepOption: "Keep each conversation",
    sessionFreshOption: "Fresh run per message",
    sessionKeepHint: "The agent remembers each conversation.",
    sessionFreshHint: "Every message is a fresh run.",
    turnsPerHourLabel: "Turns per hour",
    routeIdPlaceholder: "support-dm",
    routeIdHint: "A short name, like support-dm. It cannot change later.",
    channelFieldHint: "The account the message arrives on.",
    agentFieldHint: "The saved agent that answers.",
    agentRequired: "Pick the agent that answers.",
    accessNote: "",
    maxIterationsHint: "Per turn. Empty uses the agent's own limit.",
    turnLimitLegend: "When a turn takes too long or fails",
    turnLimitLabel: "Turn limit (seconds)",
    turnLimitHint: "A turn still running after this is stopped and counted as failed. Empty uses",
    turnLimitMin: "Turn limit must be 1 second or more.",
    routeScope: "any conversation",
    accessBadge: "Talk",
    inCounter: "in",
    outCounter: "out",
  },
  webhook: {
    label: "Webhook",
    blurb: "An inbound HTTP trigger. Your service POSTs signed JSON to a local port; put a tunnel or proxy in front to reach it from outside.",
    credential: { field: "secret", label: "Signing secret", hint: "Requests must carry an HMAC-SHA256 signature made with it. Saved encrypted.", placeholder: "whsec_..." },
    senderExample: "webhook:caller-42",
    testTitle: "Send test request",
    testLead: "Post a signed request to this webhook from the Cortex server. If a route is on, the agent runs.",
    routeDeleteNote: "Requests that matched it fall through to the next route, or are not handled.",
    noRouteNote: "A webhook with no route accepts requests but nothing runs. Route it to an agent.",
    sessionLabel: "Memory between requests",
    sessionKeepOption: "Keep each thread",
    sessionFreshOption: "Fresh run per request",
    sessionKeepHint: "Requests that carry the same threadId share the agent's memory.",
    sessionFreshHint: "Every request is a fresh run.",
    turnsPerHourLabel: "Runs per hour",
    routeIdPlaceholder: "deploy-hook",
    routeIdHint: "A short name, like deploy-hook. It cannot change later.",
    channelFieldHint: "The webhook channel that receives the request.",
    agentFieldHint: "The saved agent that runs when it is called.",
    agentRequired: "Pick the agent that runs when the webhook is called.",
    accessNote: "Requests are authorised by the channel's signing secret.",
    maxIterationsHint: "Per run. Empty uses the agent's own limit.",
    turnLimitLegend: "When a run takes too long",
    turnLimitLabel: "Run limit (seconds)",
    turnLimitHint: "A run still going after this is stopped and counted as failed. Empty uses",
    turnLimitMin: "Run limit must be 1 second or more.",
    routeScope: "every signed request",
    accessBadge: "Access",
    inCounter: "received",
    outCounter: "answered",
  },
};

/** The kinds in display order. */
export const CHANNEL_KIND_ORDER: readonly ChannelKind[] = ["telegram", "signal", "webhook"];

/** Copy for `kind`; an unknown platform string falls back to Telegram's (a messaging channel). */
export function channelKindCopy(kind: string | undefined): ChannelKindCopy {
  return kind === "webhook" || kind === "signal" ? CHANNEL_KIND_COPY[kind] : CHANNEL_KIND_COPY.telegram;
}

/** The webhook-only fields and the connection panel. Same no-messaging-words rule as the webhook kind copy. */
export const WEBHOOK_COPY = {
  listenPort: { label: "Listen port", hint: "Cortex listens on 127.0.0.1 at this port. Front it with a tunnel or proxy to reach it from elsewhere.", placeholder: "7700" },
  path: { label: "Path", hint: "Callers POST here:" },
  callback: { label: "Callback URL", hint: "Where the agent's result is POSTed as JSON. Leave empty to only receive.", placeholder: "https://example.com/callback" },
  callbackIssue: "The callback URL must start with http:// or https://.",
  loopbackOnly: "This address is loopback only: callers on this machine can reach it, nothing else can. Put a tunnel or reverse proxy in front for outside callers.",
  noPort: "Set a listen port to see the full URL. Until then only the path is known.",
  secretPlaceholder: "$WEBHOOK_SECRET stands for your signing secret in every example. The real secret is never shown here.",
  generate: "Generate secret",
  generateHint: "Creates a random signing secret, stores it encrypted, and shows it once so you can copy it to the caller. It cannot be shown again.",
  generatedOnce: "Copy this secret now. It is not shown again.",
  generateReplaces: "A secret is already saved. Generating a new one replaces it, and callers using the old one are refused.",
  sendTest: "Send test request",
  sendTestWarn: "This delivers a real signed request. If a route on this webhook is on, the agent runs.",
  accepted: "Accepted",
  refused: "Refused",
  noSecret: "Save a signing secret first.",
  connectTitle: "Connect a caller",
  loading: "Loading how to connect…",
  copy: "Copy",
  copied: "Copied",
  factMethod: "Method",
  factUrl: "URL",
  factPath: "Path",
  factContentType: "Content type",
  factSignatureHeader: "Signature header",
  factAlgorithm: "Algorithm",
  factSignedPayload: "Signed payload",
  factTimestampHeader: "Timestamp header",
  factTimestamp: "Timestamp",
  factReplay: "Replay",
  examplesTitle: "Examples",
  dismiss: "Done",
} as const;

/** Every string a webhook surface can show, for the vocabulary test. */
export function webhookCopyStrings(): string[] {
  const kind = CHANNEL_KIND_COPY.webhook;
  const flat = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : typeof v === "object" && v !== null ? flat(v) : []));
  return [...flat(kind), ...flat(WEBHOOK_COPY)];
}
