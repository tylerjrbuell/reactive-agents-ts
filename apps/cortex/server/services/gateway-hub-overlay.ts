/**
 * What the Gateway overview shows for channels the channel hub hosts.
 *
 * A gateway agent whose channels the hub owns builds no adapters of its own (`GatewayChannelHost.sync`
 * skips them: one poller per bot token), so the host has nothing live to report for them. The truth is the
 * hub's router status. These pure helpers map a {@link HubStatus} onto the host's report shapes so the card
 * reads connection state, counters and the activity feed from the same source as the Channels tab.
 */
import type { AccessSummary, CortexChannelEntry } from "./channel-config.js";
import type { ChannelLiveState, HostedGatewayStatus } from "./gateway-channel-host.js";
import type { HubActivity } from "./channel-hub-activity.js";
import type { HubChannelView, HubStatus } from "./channel-hub.js";
import type { GatewayActivity } from "./gateway-status.js";

/** Note shown when the hub has no view of a channel it owns (not loaded yet). */
export const HUB_NOTE = "Hosted by the channel hub. Its state is under Routes.";

const ACTIVITY_LIMIT = 50;

/** One hub-owned channel as the overview row: the hub's live state and counters, never zeros it did not measure. */
export function hubChannelState(entry: CortexChannelEntry, view: HubChannelView | undefined): ChannelLiveState {
  const base = { id: entry.id, kind: entry.kind, label: entry.label ?? null, enabled: entry.enabled };
  if (!view) {
    return { ...base, state: "not-started", error: null, reason: HUB_NOTE, received: 0, sent: 0, failed: 0, lastInboundAt: null, lastSentAt: null, lastFailure: null };
  }
  const counters = {
    received: view.received,
    sent: view.sent,
    failed: view.failed,
    lastInboundAt: view.lastInboundAt,
    lastSentAt: view.lastSentAt,
    lastFailure: view.error?.kind ?? null,
  };
  // `idle` (enabled, no enabled route) is not a connection state the overview knows: it is "not running" with the hub's reason.
  const state = view.state === "idle" ? "not-started" : view.state;
  return { ...base, ...counters, state, error: view.error, reason: view.reason ?? (state === "connected" ? HUB_NOTE : null) };
}

/** The host phase for an agent whose only channels live in the hub: it listens when the hub does. */
export function hubHostPhase(host: Pick<HostedGatewayStatus, "phase" | "error" | "startedAt">, hubOwned: number, hub: HubStatus | null): Pick<HostedGatewayStatus, "phase" | "error" | "startedAt"> {
  if (host.phase !== "idle" || hubOwned === 0 || !hub) return { phase: host.phase, error: host.error, startedAt: host.startedAt };
  switch (hub.phase) {
    case "running": return { phase: "running", error: null, startedAt: hub.startedAt };
    case "starting": return { phase: "starting", error: null, startedAt: null };
    case "failed": return { phase: "failed", error: hub.error ?? "The channel hub could not start.", startedAt: null };
    default: return { phase: "idle", error: null, startedAt: null };
  }
}

const KIND: Readonly<Partial<Record<HubActivity["kind"], GatewayActivity["kind"]>>> = {
  matched: "received",
  answered: "sent",
  failed: "failed",
  dropped: "dropped",
  denied: "denied",
};

/** The hub's feed lines for these channels as overview lines (simulated messages and kinds with no overview word are left out). */
export function hubActivityFor(hub: HubStatus, channelIds: ReadonlySet<string>): GatewayActivity[] {
  const channelOfRoute = new Map(hub.routes.map((r) => [r.id, r.channelId] as const));
  const out: GatewayActivity[] = [];
  for (const a of hub.activity) {
    const kind = KIND[a.kind];
    const channelId = a.channelId ?? (a.routeId ? channelOfRoute.get(a.routeId) : undefined);
    if (!kind || a.simulated || !channelId || !channelIds.has(channelId)) continue;
    out.push({ at: a.at, kind, channelId, detail: a.detail });
  }
  return out;
}

/** Host activity and hub activity as one newest-first, bounded list. */
export function mergeActivity(host: readonly GatewayActivity[], hubLines: readonly GatewayActivity[]): GatewayActivity[] {
  return [...host, ...hubLines].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT);
}

/**
 * Who can reach an agent whose messages arrive through hub routes: the routes decide, not the agent's own
 * `gateway.accessControl` (a migrated agent's old allowlist goes stale once its routes are edited). The
 * enabled routes that target the agent: any open one means open; otherwise owners plus allow-listed senders
 * (counts, never the keys); none of either means nobody. No enabled route = the agent's own setting stands.
 */
export function hubAccessFor(agentId: string, hub: HubStatus | null, own: AccessSummary): AccessSummary {
  // A webhook route has no sender lists (access is the signing secret), so it says nothing about who may write.
  const webhook = new Set((hub?.channels ?? []).filter((c) => c.platform === "webhook").map((c) => c.id));
  const routes = (hub?.routes ?? []).filter((r) => r.enabled && r.target.kind === "agent" && r.target.id === agentId && !webhook.has(r.channelId));
  if (routes.length === 0) return own;
  const allowed = routes.reduce((n, r) => n + r.access.owners + r.access.allow, 0);
  const blocked = routes.reduce((n, r) => n + r.access.deny, 0);
  if (routes.some((r) => r.access.open)) return { mode: "open", allowed, blocked };
  return { mode: allowed === 0 ? "deny-all" : "allowlist", allowed, blocked };
}

/** Senders the routes of these channels refused since the hub started. */
export function hubDenied(hub: HubStatus, channelIds: ReadonlySet<string>): number {
  return hub.routes.filter((r) => channelIds.has(r.channelId)).reduce((n, r) => n + r.counters.denied, 0);
}
