/**
 * Lab · Channels: the channel entries a gateway agent's config carries and the rules the
 * editor applies to them. Pure (no fetch, no DOM); the server counterpart is
 * `server/services/channel-config.ts`, which cuts anything not listed here.
 *
 * A channel holds only non-secret settings. Its credential (bot token, Signal account, webhook
 * signing secret) is saved on its own through `lib/gateway-api.ts` and never enters the config.
 */

/** The adapters Cortex configures. */
export type ChannelKind = "telegram" | "signal" | "webhook";

/** Non-secret per-kind settings (same fields as the server's `CortexChannelSettings`). */
export interface ChannelSettings {
  transport?: "socket" | "process";
  host?: string;
  port?: number;
  path?: string;
  route?: string;
  ingressPort?: number;
  replyUrl?: string;
}

/** One configured channel, as saved on the agent. */
export interface ChannelEntry {
  id: string;
  kind: ChannelKind;
  label?: string;
  enabled: boolean;
  settings: ChannelSettings;
}

/** What the editor shows for one kind. */
export interface ChannelKindInfo {
  readonly kind: ChannelKind;
  readonly label: string;
  /** One line of what it is and what it needs. */
  readonly blurb: string;
  /** The single credential the kind needs. */
  readonly credential: { readonly field: string; readonly label: string; readonly hint: string; readonly placeholder: string };
  /** Sender keys look like `<platform>:<id>`; this is the example for the access editor. */
  readonly senderExample: string;
}

/** The kinds in display order. */
export const CHANNEL_KINDS: readonly ChannelKindInfo[] = [
  {
    kind: "telegram",
    label: "Telegram",
    blurb: "A bot made with BotFather. Cortex polls Telegram, so no public URL is needed.",
    credential: { field: "token", label: "Bot token", hint: "From @BotFather (/newbot). Saved encrypted; never shown again.", placeholder: "123456789:AA..." },
    senderExample: "telegram:123456789",
  },
  {
    kind: "signal",
    label: "Signal",
    blurb: "A registered number reached through signal-cli (a running daemon, or spawned by Cortex).",
    credential: { field: "account", label: "Account number", hint: "The registered number, with country code. Saved encrypted.", placeholder: "+15551234567" },
    senderExample: "signal:+15551234567",
  },
  {
    kind: "webhook",
    label: "Webhook",
    blurb: "Signed HTTP requests from your own service. Listens on a local port; put a tunnel or proxy in front.",
    credential: { field: "secret", label: "Signing secret", hint: "Requests must carry an HMAC-SHA256 signature made with it. Saved encrypted.", placeholder: "whsec_..." },
    senderExample: "webhook:user-42",
  },
];

const KIND_BY_ID = new Map(CHANNEL_KINDS.map((k) => [k.kind, k] as const));

/** The editor copy for a kind. */
export function channelKindInfo(kind: ChannelKind): ChannelKindInfo {
  return KIND_BY_ID.get(kind) ?? CHANNEL_KINDS[0]!;
}

/** A fresh channel id: `ch-` and 8 hex characters. Unique per channel; also the key of its credential. */
export function newChannelId(random: () => number = Math.random): string {
  let hex = "";
  for (let i = 0; i < 8; i++) hex += Math.floor(random() * 16).toString(16);
  return `ch-${hex}`;
}

/** A new, enabled channel with no settings. */
export function newChannel(kind: ChannelKind, id: string = newChannelId()): ChannelEntry {
  return { id, kind, enabled: true, settings: kind === "signal" ? { transport: "socket" } : {} };
}

/** The channels of a config, tolerant of a missing or malformed list. */
export function channelsOf(config: { readonly channels?: unknown }): ChannelEntry[] {
  if (!Array.isArray(config.channels)) return [];
  return config.channels.filter(
    (c): c is ChannelEntry =>
      typeof c === "object" && c !== null && typeof (c as ChannelEntry).id === "string" && KIND_BY_ID.has((c as ChannelEntry).kind),
  );
}

/** `list` with `entry` appended. */
export const addChannel = (list: readonly ChannelEntry[], entry: ChannelEntry): ChannelEntry[] => [...list, entry];

/** `list` without the channel `id`. */
export const removeChannel = (list: readonly ChannelEntry[], id: string): ChannelEntry[] => list.filter((c) => c.id !== id);

/** `list` with the channel `id` changed; a settings patch merges and a key set to undefined is removed. */
export function updateChannel(
  list: readonly ChannelEntry[],
  id: string,
  patch: { readonly label?: string | undefined; readonly enabled?: boolean; readonly settings?: Partial<Record<keyof ChannelSettings, ChannelSettings[keyof ChannelSettings] | undefined>> },
): ChannelEntry[] {
  return list.map((c) => {
    if (c.id !== id) return c;
    const next: ChannelEntry = { ...c, settings: { ...c.settings } };
    if ("label" in patch) {
      const label = patch.label?.trim();
      if (label) next.label = label;
      else delete next.label;
    }
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.settings) {
      const merged: Record<string, unknown> = { ...next.settings };
      for (const [k, v] of Object.entries(patch.settings)) {
        if (v === undefined || v === "") delete merged[k];
        else merged[k] = v;
      }
      next.settings = merged as ChannelSettings;
    }
    return next;
  });
}

/** The name shown for a channel: its label, else the kind. */
export const channelName = (c: ChannelEntry): string => c.label?.trim() || channelKindInfo(c.kind).label;

const validPort = (n: number | undefined): boolean => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 65535);

/**
 * What stops a channel from starting, in one sentence each (empty = ready). `credentialSaved` is
 * whether its credential is stored. Mirrors what the server skips (`channel-adapters.ts`).
 */
export function channelIssues(c: ChannelEntry, credentialSaved: boolean): string[] {
  const issues: string[] = [];
  const cred = channelKindInfo(c.kind).credential;
  if (!credentialSaved) issues.push(`No ${cred.label.toLowerCase()} saved.`);
  if (!validPort(c.settings.port)) issues.push("The port must be between 1 and 65535.");
  if (c.kind === "webhook") {
    if (c.settings.ingressPort === undefined) issues.push("Set the port the webhook listens on.");
    else if (!validPort(c.settings.ingressPort)) issues.push("The listen port must be between 1 and 65535.");
    const url = c.settings.replyUrl?.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) issues.push("The reply URL must start with http:// or https://.");
  }
  return issues;
}

/** The URL path a webhook channel serves (its route, else `/channels/<id>`). */
export const webhookRoute = (c: ChannelEntry): string => c.settings.route?.trim() || `/channels/${c.id}`;

/**
 * Whether the Channels editor applies where it is shown. Channels (and the gateway block:
 * access control, queue, schedules) run only inside a saved Gateway process agent
 * (`GatewayChannelHost`). A chat session is an in-process conversation with no channel host, and its
 * config endpoint does not store `channels` or `gateway`, so the editor must say so instead of
 * accepting input that the save would drop.
 */
export function channelsSurface(inChatSession: boolean): { readonly editable: boolean; readonly note: string | null } {
  return inChatSession
    ? {
        editable: false,
        note: "Channels run only on a saved Gateway agent, not in a chat session. Set them up in Lab: save the agent as a Gateway process, add the channel there, and it answers on Telegram, Signal or a webhook without a browser open.",
      }
    : { editable: true, note: null };
}
