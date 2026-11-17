/**
 * The calls Lab · Channels makes to `/api/channels` (the channel hub). Each returns a tagged result
 * and never throws. A credential never travels here: it is saved through `lib/gateway-api.ts`
 * (write-only) and this API answers with masks only.
 */
import { call, isRecord, json, type ApiResult, type Fetcher } from "./gateway-api.js";
import type { ChannelKind, ChannelSettings } from "./channels.js";
import type { HubRouteWire } from "./channel-hub.js";
import { parseInboxCounts, type InboxCountsWire } from "./channel-inbox.js";
import { parseOutboxCounts, parseTimerCounts, type OutboxCountsWire, type TimerCountsWire } from "./channel-router-queues.js";

/** One credential field as the hub reports it (mask only). */
export interface HubCredentialMask {
  readonly field: string;
  readonly masked: string | null;
}

/** A hub channel row (non-secret settings and credential masks). */
export interface HubChannelRow {
  readonly id: string;
  readonly platform: ChannelKind;
  readonly label: string | null;
  readonly enabled: boolean;
  readonly settings: ChannelSettings;
  readonly migratedFrom: string | null;
  readonly credentials: readonly HubCredentialMask[];
}

/** `GET /api/channels`. */
export interface HubSnapshot {
  readonly hubEnabled: boolean;
  readonly channels: readonly HubChannelRow[];
  readonly routes: readonly HubRouteWire[];
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
}

/** One channel's live state from `GET /api/channels/status`. */
export interface HubChannelLive {
  readonly id: string;
  readonly state: string;
  readonly error: { readonly kind: string; readonly message: string } | null;
  readonly reason: string | null;
  readonly conflict: boolean;
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
}

/** Who holds an account right now (channel and process; never the account itself). */
export interface HubLease {
  readonly channelId: string;
  readonly pid: number;
}

/** The parts of `GET /api/channels/status` the page reads. */
export interface HubLive {
  readonly phase: string;
  readonly error: string | null;
  readonly leases: readonly HubLease[];
  readonly durableStore: boolean;
  /** Envelope counts per status; null when the router's store keeps no durable inbox. */
  readonly inbox: InboxCountsWire | null;
  /** Outgoing message counts per status; null when the router keeps no durable outbox. */
  readonly outbox: OutboxCountsWire | null;
  /** Follow-up timer counts per status; null when the router runs without follow-up timers. */
  readonly timers: TimerCountsWire | null;
  readonly channels: readonly HubChannelLive[];
  readonly routes: readonly { readonly id: string; readonly active: boolean; readonly reason: string | null; readonly roleNote: string | null }[];
}

const KINDS: readonly string[] = ["telegram", "signal", "webhook"];

const parseCred = (v: unknown): HubCredentialMask | null =>
  isRecord(v) && typeof v.field === "string" ? { field: v.field, masked: typeof v.masked === "string" ? v.masked : null } : null;

const parseChannel = (v: unknown): HubChannelRow | null =>
  isRecord(v) && typeof v.id === "string" && typeof v.platform === "string" && KINDS.includes(v.platform)
    ? {
        id: v.id,
        platform: v.platform as ChannelKind,
        label: typeof v.label === "string" ? v.label : null,
        enabled: v.enabled !== false,
        settings: isRecord(v.settings) ? (v.settings as ChannelSettings) : {},
        migratedFrom: typeof v.migratedFrom === "string" ? v.migratedFrom : null,
        credentials: Array.isArray(v.credentials) ? v.credentials.map(parseCred).filter((c): c is HubCredentialMask => c !== null) : [],
      }
    : null;

const isRoute = (v: unknown): v is HubRouteWire =>
  isRecord(v) && typeof v.id === "string" && isRecord(v.match) && typeof v.match.channelId === "string" && isRecord(v.target) && typeof v.target.agentId === "string";

const parseSnapshot = (v: unknown): HubSnapshot | null =>
  isRecord(v) && Array.isArray(v.channels) && Array.isArray(v.routes)
    ? {
        hubEnabled: v.hubEnabled !== false,
        channels: v.channels.map(parseChannel).filter((c): c is HubChannelRow => c !== null),
        routes: v.routes.filter(isRoute),
        rejected: Array.isArray(v.rejected)
          ? v.rejected.filter(isRecord).map((r) => ({ id: String(r.routeId ?? ""), reason: String(r.reason ?? "") }))
          : [],
      }
    : null;

const parseLive = (v: unknown): HubLive | null => {
  if (!isRecord(v) || !Array.isArray(v.channels) || !Array.isArray(v.routes)) return null;
  return {
    phase: typeof v.phase === "string" ? v.phase : "idle",
    error: typeof v.error === "string" ? v.error : null,
    leases: Array.isArray(v.leases) ? v.leases.filter(isRecord).filter((l) => typeof l.channelId === "string").map((l) => ({ channelId: String(l.channelId), pid: Number(l.pid ?? 0) })) : [],
    durableStore: v.durableStore === true,
    inbox: parseInboxCounts(v.router),
    outbox: parseOutboxCounts(v.router),
    timers: parseTimerCounts(v.router),
    channels: v.channels.filter(isRecord).map((c) => ({
      id: String(c.id),
      state: String(c.state ?? "not-started"),
      error: isRecord(c.error) && typeof c.error.message === "string" ? { kind: String(c.error.kind ?? ""), message: c.error.message } : null,
      reason: typeof c.reason === "string" ? c.reason : null,
      conflict: c.conflict === true,
      received: Number(c.received ?? 0),
      sent: Number(c.sent ?? 0),
      failed: Number(c.failed ?? 0),
    })),
    routes: v.routes.filter(isRecord).map((r) => ({
      id: String(r.id),
      active: r.active === true,
      reason: typeof r.reason === "string" ? r.reason : null,
      roleNote: typeof r.roleNote === "string" ? r.roleNote : null,
    })),
  };
};

/** A saved agent a route can point at. */
export interface AgentChoice {
  readonly agentId: string;
  readonly name: string;
}

/** The saved agents (`GET /api/agents`), id and name only. */
export const fetchAgentChoices = (base: string, fetcher: Fetcher) =>
  call(fetcher, `${base}/api/agents`, undefined, (v): AgentChoice[] | null =>
    Array.isArray(v) ? v.filter(isRecord).filter((a) => typeof a.agentId === "string").map((a) => ({ agentId: String(a.agentId), name: typeof a.name === "string" ? a.name : String(a.agentId) })) : null,
  );

/** Channels and routes as saved. */
export const fetchHub = (base: string, fetcher: Fetcher) => call(fetcher, `${base}/api/channels`, undefined, parseSnapshot);

/** Live state of the running hub. */
export const fetchHubLive = (base: string, fetcher: Fetcher) => call(fetcher, `${base}/api/channels/status`, undefined, parseLive);

/** Create a channel (non-secret fields only; the credential is saved afterwards, write-only). */
export const createHubChannel = (base: string, fetcher: Fetcher, body: { kind: ChannelKind; label?: string; settings?: ChannelSettings }) =>
  call(fetcher, `${base}/api/channels`, { method: "POST", ...json(body) }, parseChannel);

/** Change a channel's label, settings or enabled flag. */
export const patchHubChannel = (base: string, fetcher: Fetcher, id: string, body: { label?: string; enabled?: boolean; settings?: ChannelSettings }) =>
  call(fetcher, `${base}/api/channels/${encodeURIComponent(id)}`, { method: "PATCH", ...json(body) }, parseChannel);

/** Delete a channel, its credentials, and with `force` its routes. */
export const deleteHubChannel = (base: string, fetcher: Fetcher, id: string, force: boolean) =>
  call(fetcher, `${base}/api/channels/${encodeURIComponent(id)}${force ? "?force=1" : ""}`, { method: "DELETE" }, (v) => (isRecord(v) ? true : null));

/** A save the server held back because it widens access. `required` are the tokens to confirm. */
export interface NeedsConfirm {
  readonly needsConfirm: readonly string[];
}

/** A route save: stored, or held for an audited confirm, or refused with a reason. */
export type SaveRouteResult = ApiResult<HubRouteWire> | ({ readonly ok: false; readonly error: string } & NeedsConfirm);

/**
 * The patch that turns `saved` into `next`: every field of `next`, and `null` for each saved field
 * `next` no longer has (the server clears a null field; a bare merge could never remove one).
 */
export function routePatch(saved: HubRouteWire, next: HubRouteWire): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...next };
  for (const key of Object.keys(saved)) {
    if (key === "migratedFrom" || key === "id") continue;
    if (!(key in next)) patch[key] = null;
  }
  delete patch.id;
  delete patch.migratedFrom;
  return patch;
}

/** Create (no `saved`) or change a route. `confirm` names each widening change the person agreed to. */
export async function saveHubRoute(
  base: string,
  fetcher: Fetcher,
  next: HubRouteWire,
  saved: HubRouteWire | undefined,
  confirm: readonly string[],
): Promise<SaveRouteResult> {
  const url = saved ? `${base}/api/channels/routes/${encodeURIComponent(saved.id)}` : `${base}/api/channels/routes`;
  const body = { route: saved ? routePatch(saved, next) : next, ...(confirm.length > 0 ? { confirm } : {}) };
  try {
    const res = await fetcher(url, { method: saved ? "PATCH" : "POST", ...json(body) });
    const parsed: unknown = await res.json().catch(() => undefined);
    if (res.status === 409 && isRecord(parsed) && parsed.error === "confirmation_required" && Array.isArray(parsed.required)) {
      return { ok: false, error: "This change widens access and needs your confirmation.", needsConfirm: parsed.required.filter((t): t is string => typeof t === "string") };
    }
    if (!res.ok) return { ok: false, error: isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : `Server answered ${res.status}.` };
    return isRoute(parsed) ? { ok: true, value: parsed } : { ok: false, error: "The server sent an unexpected answer." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the Cortex server." };
  }
}

/** Delete a route. */
export const deleteHubRoute = (base: string, fetcher: Fetcher, id: string) =>
  call(fetcher, `${base}/api/channels/routes/${encodeURIComponent(id)}`, { method: "DELETE" }, (v) => (isRecord(v) ? true : null));

/** A message to try. */
export interface ProbeInput {
  readonly channelId: string;
  readonly userId: string;
  readonly text: string;
  readonly isGroup?: boolean;
  readonly mentionsSelf?: boolean;
}

/** Both probes: `explain` (pure: which route, which role, which tools, why) and `simulate` (a real run; nothing is sent). */
export async function probeHub(base: string, fetcher: Fetcher, input: ProbeInput, run: boolean): Promise<ApiResult<{ explain: unknown; simulate: unknown }>> {
  const explain = await call<unknown>(fetcher, `${base}/api/channels/explain`, { method: "POST", ...json(input) }, (v) => v);
  if (!explain.ok) return explain;
  if (!run) return { ok: true, value: { explain: explain.value, simulate: null } };
  const simulate = await call<unknown>(fetcher, `${base}/api/channels/simulate`, { method: "POST", ...json(input) }, (v) => v);
  return simulate.ok ? { ok: true, value: { explain: explain.value, simulate: simulate.value } } : simulate;
}
