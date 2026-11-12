/**
 * The messaging channels of a gateway agent, as the stored agent config carries them.
 *
 * `channels` on the saved config is a list of entries; an entry holds only what is safe to
 * read back (kind, label, host/port, path). Credentials (Telegram bot token, Signal account,
 * webhook signing secret) are never in the config: they live sealed in the key store under
 * the channel id (`channel-credentials.ts`) and reach the adapter at start time.
 *
 * Access control is the framework's own `gateway.accessControl` (an AgentConfig path), not a
 * Cortex shape: empty `allowedSenders` with the default `allowlist` policy denies everyone,
 * and `accessPolicy: "open"` is the explicit opt-in to accept anyone. Cortex re-defaults
 * neither (`ui/src/lib/channel-access.ts` is the editor's logic).
 */

/** The adapters Cortex can configure. */
export const CHANNEL_KINDS = ["telegram", "signal", "webhook"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Credential fields per kind: the only values the key store holds for a channel. */
export const CHANNEL_CREDENTIAL_FIELDS: Readonly<Record<ChannelKind, readonly string[]>> = {
  telegram: ["token"],
  signal: ["account"],
  webhook: ["secret"],
};

/** Non-secret, per-kind adapter settings. Every field optional; the adapter owns the defaults. */
export interface CortexChannelSettings {
  /** Signal: `socket` talks to a running `signal-cli daemon`; `process` spawns `signal-cli`. */
  readonly transport?: "socket" | "process";
  /** Signal socket transport: daemon host (framework default 127.0.0.1). */
  readonly host?: string;
  /** Signal socket transport: daemon TCP port (framework default 7583). */
  readonly port?: number;
  /** Signal socket transport: unix socket path (instead of host/port). */
  readonly path?: string;
  /** Webhook: URL path the sender posts to. */
  readonly route?: string;
  /** Webhook: port of the ingress server (binds loopback; front it with a tunnel or proxy). */
  readonly ingressPort?: number;
  /** Webhook: URL the agent's replies are POSTed to. Validated as an outbound URL. */
  readonly replyUrl?: string;
}

/** One configured channel. */
export interface CortexChannelEntry {
  /** Stable, random, unique: also the key of its credentials. */
  readonly id: string;
  readonly kind: ChannelKind;
  /** Display name. */
  readonly label?: string;
  /** Default true. A disabled channel is kept but never started. */
  readonly enabled: boolean;
  readonly settings: CortexChannelSettings;
}

/** Channel ids are generated (`ch-` + 8 hex); this is also the path-safety rule for the key store. */
export const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const port = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : undefined;

const settingsOf = (kind: ChannelKind, raw: unknown): CortexChannelSettings => {
  const s = obj(raw) ?? {};
  if (kind === "signal") {
    const transport = s.transport === "process" ? "process" : s.transport === "socket" ? "socket" : undefined;
    const host = str(s.host);
    const p = port(s.port);
    const path = str(s.path);
    return {
      ...(transport ? { transport } : {}),
      ...(host ? { host } : {}),
      ...(p !== undefined ? { port: p } : {}),
      ...(path ? { path } : {}),
    };
  }
  if (kind === "webhook") {
    const route = str(s.route);
    const ingressPort = port(s.ingressPort);
    const replyUrl = str(s.replyUrl);
    return {
      ...(route ? { route: route.startsWith("/") ? route : `/${route}` } : {}),
      ...(ingressPort !== undefined ? { ingressPort } : {}),
      ...(replyUrl ? { replyUrl } : {}),
    };
  }
  return {};
};

/**
 * The channel entries a stored config carries. Unknown kinds, bad ids and duplicates are
 * dropped; settings are cut to the kind's known fields, so a stray credential-looking key
 * (`token`, `secret`, `account`) in a hand-edited config is never kept or forwarded.
 */
export function parseCortexChannels(raw: unknown): CortexChannelEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CortexChannelEntry[] = [];
  for (const item of raw) {
    const o = obj(item);
    if (!o) continue;
    const id = str(o.id);
    const kind = CHANNEL_KINDS.find((k) => k === o.kind);
    if (!id || !CHANNEL_ID_PATTERN.test(id) || !kind || seen.has(id)) continue;
    seen.add(id);
    const label = str(o.label);
    out.push({ id, kind, ...(label ? { label } : {}), enabled: o.enabled !== false, settings: settingsOf(kind, o.settings) });
  }
  return out;
}

/** The channels that should be started: enabled entries only. */
export const enabledChannels = (entries: readonly CortexChannelEntry[]): CortexChannelEntry[] =>
  entries.filter((e) => e.enabled);

/**
 * The gateway options Cortex curates, as the framework's `GatewayConfig` subset:
 * `accessControl`, `queue` and `crons`. Other `gateway.*` paths (heartbeat, policies, timezone)
 * stay generic (All framework options, `rawConfig.gateway`) and merge under these.
 */
export interface CortexGatewayConfig {
  readonly accessControl?: {
    readonly accessPolicy?: "allowlist" | "blocklist" | "open";
    readonly allowedSenders?: readonly string[];
    readonly blockedSenders?: readonly string[];
    readonly unknownSenderAction?: "skip" | "escalate";
    readonly replyToUnknown?: string;
    readonly mode?: "chat" | "task";
    readonly sessionTtlDays?: number;
  };
  readonly queue?: { readonly capacity?: number; readonly overflow?: "drop-oldest" | "drop-newest" };
  readonly crons?: readonly {
    readonly schedule: string;
    readonly instruction: string;
    readonly priority?: "low" | "normal" | "high" | "critical";
    readonly timezone?: string;
    readonly enabled?: boolean;
  }[];
}

/** Who may message a gateway agent, in the words the overview shows. */
export interface AccessSummary {
  /** `deny-all`: the allowlist (the framework default) is empty, so every sender is refused. */
  readonly mode: "deny-all" | "allowlist" | "blocklist" | "open";
  readonly allowed: number;
  readonly blocked: number;
}

/** The framework's access rule for `gateway.accessControl`: default policy `allowlist`; an empty allowlist denies everyone. */
export function summarizeAccess(gateway: CortexGatewayConfig | undefined): AccessSummary {
  const ac = gateway?.accessControl;
  const policy = ac?.accessPolicy ?? "allowlist";
  const allowed = ac?.allowedSenders?.length ?? 0;
  const blocked = ac?.blockedSenders?.length ?? 0;
  if (policy === "open") return { mode: "open", allowed, blocked };
  if (policy === "blocklist") return { mode: "blocklist", allowed, blocked };
  return { mode: allowed === 0 ? "deny-all" : "allowlist", allowed, blocked };
}

const strList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const items = v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== "");
  return [...new Set(items)];
};

/**
 * The curated gateway block of a stored config, cut to known fields (the schema decode at
 * build time rejects bad values; this only drops junk and empty strings). Undefined when empty.
 */
export function parseCortexGatewayConfig(raw: unknown): CortexGatewayConfig | undefined {
  const g = obj(raw);
  if (!g) return undefined;
  const out: { -readonly [K in keyof CortexGatewayConfig]: CortexGatewayConfig[K] } = {};

  const a = obj(g.accessControl);
  if (a) {
    const allowed = strList(a.allowedSenders);
    const blocked = strList(a.blockedSenders);
    const policy = (["allowlist", "blocklist", "open"] as const).find((p) => p === a.accessPolicy);
    const unknown = (["skip", "escalate"] as const).find((p) => p === a.unknownSenderAction);
    const reply = str(a.replyToUnknown);
    const mode = (["chat", "task"] as const).find((p) => p === a.mode);
    const ttl = typeof a.sessionTtlDays === "number" && a.sessionTtlDays > 0 ? a.sessionTtlDays : undefined;
    const ac = {
      ...(policy ? { accessPolicy: policy } : {}),
      ...(allowed ? { allowedSenders: allowed } : {}),
      ...(blocked ? { blockedSenders: blocked } : {}),
      ...(unknown ? { unknownSenderAction: unknown } : {}),
      ...(reply ? { replyToUnknown: reply } : {}),
      ...(mode ? { mode } : {}),
      ...(ttl !== undefined ? { sessionTtlDays: ttl } : {}),
    };
    if (Object.keys(ac).length > 0) out.accessControl = ac;
  }

  const q = obj(g.queue);
  if (q) {
    const capacity = typeof q.capacity === "number" && q.capacity > 0 ? q.capacity : undefined;
    const overflow = (["drop-oldest", "drop-newest"] as const).find((p) => p === q.overflow);
    if (capacity !== undefined || overflow) out.queue = { ...(capacity !== undefined ? { capacity } : {}), ...(overflow ? { overflow } : {}) };
  }

  if (Array.isArray(g.crons)) {
    const crons: NonNullable<CortexGatewayConfig["crons"]>[number][] = [];
    for (const c of g.crons) {
      const o = obj(c);
      const schedule = str(o?.schedule);
      const instruction = str(o?.instruction);
      if (!o || !schedule || !instruction) continue;
      const priority = (["low", "normal", "high", "critical"] as const).find((p) => p === o.priority);
      const timezone = str(o.timezone);
      crons.push({
        schedule,
        instruction,
        ...(priority ? { priority } : {}),
        ...(timezone ? { timezone } : {}),
        ...(typeof o.enabled === "boolean" ? { enabled: o.enabled } : {}),
      });
    }
    if (crons.length > 0) out.crons = crons;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
