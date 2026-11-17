/**
 * Lab · Channels: the words and tones the page shows for a channel's live state, its account lease
 * and a duplicate account. Pure. Colour is never the only cue: every tone comes with a label.
 */
import type { StatusTone } from "@reactive-agents/ui-core";
import type { HubChannelLive, HubLease } from "./channel-hub-api.js";

/** What a channel card shows above its settings. */
export interface LiveChannelView {
  readonly tone: StatusTone;
  readonly label: string;
  /** A sentence about what is wrong, or null. */
  readonly problem: string | null;
  readonly lease: { readonly tone: "ok" | "warn" | "neutral"; readonly label: string };
}

/** The lease line: who holds this channel's account. */
export function leaseView(channelId: string, leases: readonly HubLease[]): LiveChannelView["lease"] {
  const mine = leases.find((l) => l.channelId === channelId);
  return mine ? { tone: "ok", label: `Holds its account (pid ${mine.pid})` } : { tone: "neutral", label: "No account lease" };
}

/** "since restart" when the in / out / failed counts restart from zero with the server; null when they come from stored rows (or there is no report yet). */
export function countsSuffix(live: Pick<HubChannelLive, "countsFrom"> | undefined): string | null {
  return live && live.countsFrom !== "stored" ? "since restart" : null;
}

/** Tone, label and problem sentence for one channel. `live` is absent while the hub has not reported it. */
export function liveChannelView(channelId: string, live: HubChannelLive | undefined, enabled: boolean, routeCount: number, leases: readonly HubLease[] = []): LiveChannelView {
  const lease = leaseView(channelId, leases);
  if (!enabled) return { tone: "stopped", label: "Off", problem: null, lease };
  if (!live) return { tone: "idle", label: "Not reported yet", problem: null, lease };
  if (live.conflict) return { tone: "failed", label: "Account in use elsewhere", problem: "Another program is polling this account, so Cortex stopped this channel. Stop the other one, or use a different bot.", lease };
  switch (live.state) {
    case "connected": return { tone: "running", label: "Connected", problem: null, lease };
    case "connecting": return { tone: "attention", label: "Connecting", problem: null, lease };
    case "reconnecting": return { tone: "attention", label: "Reconnecting", problem: live.error?.message ?? null, lease };
    case "failed": return { tone: "failed", label: "Failed", problem: live.error?.message ?? live.reason, lease };
    case "skipped": return { tone: "failed", label: "Not started", problem: live.reason, lease };
    case "idle": return { tone: "idle", label: routeCount === 0 ? "No route yet" : "No enabled route", problem: null, lease };
    default: return { tone: "idle", label: "Not started", problem: live.reason, lease };
  }
}

/** A channel whose account another channel (or process) already holds. */
export interface DuplicateInfo {
  /** The channel that holds the account, when it is one of ours. */
  readonly ownerChannelId: string | null;
  readonly ownerPid: number | null;
}

const OWNED = /already owns the account behind channel (\S+?)\./;

/**
 * Duplicate-account refusals. The hub's failure text names the channel that was refused
 * ("... the account behind channel ch-x."); its lease row names who holds the account. A holder that
 * is another channel in this hub is linked; a holder that is another process shows its pid.
 */
export function duplicateAccounts(hubError: string | null, leases: readonly HubLease[]): ReadonlyMap<string, DuplicateInfo> {
  const out = new Map<string, DuplicateInfo>();
  const refused = hubError ? OWNED.exec(hubError)?.[1] : undefined;
  if (!refused) return out;
  const owner = leases.find((l) => l.channelId !== refused);
  out.set(refused, { ownerChannelId: owner?.channelId ?? null, ownerPid: owner?.pid ?? null });
  return out;
}

/** The sentence for a duplicate, naming the owner by label when it is linked. */
export function duplicateSentence(d: DuplicateInfo, ownerName: string | null): string {
  if (d.ownerChannelId && ownerName) return `This account is already in use by ${ownerName}. Each account can be open once: delete this channel or edit the other.`;
  return d.ownerPid !== null ? `Another process (pid ${d.ownerPid}) already uses this account.` : "Another process already uses this account.";
}
