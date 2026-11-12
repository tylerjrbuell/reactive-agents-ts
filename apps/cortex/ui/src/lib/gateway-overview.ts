/**
 * The Gateway overview: the shape of `GET /api/gateway/status` and the words each part shows.
 * Pure view logic (tone, label, sentence) so the component only lays it out. Colour is never
 * the only cue: every tone comes with a label.
 */
import type { StatusTone } from "@reactive-agents/ui-core";
import { formatRelativeTime } from "@reactive-agents/ui-core";
import type { ApiResult, Fetcher } from "./gateway-api.js";
import { accessSentence, type AccessMode } from "./channel-access.js";

/** A channel's live state as the server reports it. */
export type ChannelStateName = "connected" | "connecting" | "reconnecting" | "disconnected" | "failed" | "not-started" | "skipped";

/** One channel row. */
export interface ChannelStatusRow {
  readonly id: string;
  readonly kind: "telegram" | "signal" | "webhook";
  readonly label: string | null;
  readonly enabled: boolean;
  readonly state: ChannelStateName;
  readonly error: { readonly kind: string; readonly message: string } | null;
  readonly reason: string | null;
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
  readonly lastInboundAt: number | null;
  readonly lastSentAt: number | null;
  readonly lastFailure: string | null;
}

/** One framework schedule with its latest runs. */
export interface ScheduleStatusRow {
  readonly id: string;
  readonly name: string | null;
  readonly cron: string | null;
  readonly instruction: string;
  readonly enabled: boolean;
  readonly nextFireAt: number | null;
  readonly runCount: number;
  readonly runs: readonly { readonly firedAt: number; readonly status: string; readonly error: string | null; readonly deliveryStatus: string | null }[];
}

/** One line of the activity list. */
export interface ActivityRow {
  readonly at: number;
  readonly kind: "received" | "sent" | "failed" | "queued" | "deferred" | "dropped" | "denied" | "trigger";
  readonly channelId?: string;
  readonly detail: string;
}

/** The framework's live inbound queue. Bounds are null when neither the running gateway nor the saved config states them. */
export interface QueueStatus {
  /** Events cleared to run, waiting for the single worker. */
  readonly ready: number;
  /** Events held by the policy until a limit window rolls. */
  readonly deferred: number;
  /** Events discarded because a list was full, since the gateway started. */
  readonly dropped: number;
  readonly capacity: number | null;
  readonly overflow: string | null;
}

/** One gateway agent in the overview. */
export interface GatewayAgentStatus {
  readonly agentId: string;
  readonly name: string;
  readonly status: string;
  readonly schedule: string | null;
  readonly runCount: number;
  readonly lastRunAt: number | null;
  readonly processRunning: boolean;
  readonly lastFiredAt: number | null;
  readonly access: { readonly mode: AccessMode; readonly allowed: number; readonly blocked: number };
  readonly gateway: {
    readonly phase: "idle" | "starting" | "running" | "failed";
    readonly error: string | null;
    readonly startedAt: number | null;
    readonly channels: readonly ChannelStatusRow[];
    readonly schedules: readonly ScheduleStatusRow[];
    readonly queue: QueueStatus;
    readonly denied: number;
    readonly activity: readonly ActivityRow[];
    readonly stats: Readonly<Record<string, number>> | null;
  };
}

/** The status call. The body is trusted as far as `agents` being a list: the server is Cortex's own. */
export async function fetchGatewayStatus(base: string, fetcher: Fetcher): Promise<ApiResult<readonly GatewayAgentStatus[]>> {
  try {
    const res = await fetcher(`${base}/api/gateway/status`);
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, error: `Server answered ${res.status}.` };
    const agents = (body as { agents?: unknown } | undefined)?.agents;
    return Array.isArray(agents) ? { ok: true, value: agents as GatewayAgentStatus[] } : { ok: false, error: "The server sent an unexpected answer." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the Cortex server." };
  }
}

/** A tone and a label for a channel's connection state. */
export function connectionView(row: Pick<ChannelStatusRow, "state" | "enabled">): { tone: StatusTone; label: string } {
  if (!row.enabled) return { tone: "stopped", label: "Off" };
  switch (row.state) {
    case "connected": return { tone: "running", label: "Connected" };
    case "connecting": return { tone: "attention", label: "Connecting" };
    case "reconnecting": return { tone: "attention", label: "Reconnecting" };
    case "failed": return { tone: "failed", label: "Failed" };
    case "disconnected": return { tone: "stopped", label: "Disconnected" };
    case "skipped": return { tone: "failed", label: "Not started" };
    case "not-started": return { tone: "idle", label: "Not running" };
  }
}

/** The hosted gateway's own state. */
export function hostView(phase: GatewayAgentStatus["gateway"]["phase"]): { tone: StatusTone; label: string } {
  switch (phase) {
    case "running": return { tone: "running", label: "Listening" };
    case "starting": return { tone: "attention", label: "Starting" };
    case "failed": return { tone: "failed", label: "Failed" };
    case "idle": return { tone: "idle", label: "No channels running" };
  }
}

/** "in 3 hours", "in 12 minutes", "paused" for a schedule's next fire. */
export function nextFireLabel(s: Pick<ScheduleStatusRow, "enabled" | "nextFireAt">, now: number = Date.now()): string {
  if (!s.enabled) return "Paused";
  if (s.nextFireAt === null) return "No upcoming run";
  const ms = s.nextFireAt - now;
  if (ms <= 60_000) return ms <= 0 ? "Due now" : "in under a minute";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `in ${d} days`;
}

/** Tone and label of a schedule run's outcome (framework statuses: running, completed, failed, ...). */
export function runView(status: string): { tone: StatusTone; label: string } {
  switch (status) {
    case "running": return { tone: "running", label: "Running" };
    case "completed": case "succeeded": case "ok": return { tone: "done", label: "Done" };
    case "failed": return { tone: "failed", label: "Failed" };
    case "skipped": return { tone: "stopped", label: "Skipped" };
    default: return { tone: "idle", label: status };
  }
}

/** The access line for an agent. */
export const accessLine = (a: GatewayAgentStatus["access"]): string => accessSentence(a.mode, a.allowed);

/**
 * The queue right now as one sentence: "2 of 7 waiting (1 ready, 1 deferred), 3 dropped".
 * Depth is ready + deferred, shown against the capacity of one list when it is known. Null while
 * the gateway is not running (nothing to report yet).
 */
export function queueSentence(q: QueueStatus, running: boolean): string | null {
  if (!running) return null;
  const waiting = q.ready + q.deferred;
  const of = q.capacity !== null ? ` of ${q.capacity}` : "";
  const detail = waiting > 0 ? ` (${[q.ready > 0 ? `${q.ready} ready` : "", q.deferred > 0 ? `${q.deferred} deferred` : ""].filter(Boolean).join(", ")})` : "";
  const drops = q.dropped > 0 ? `, ${q.dropped} dropped` : "";
  return `${waiting}${of} waiting${detail}${drops}`;
}

/** The queue limit as text ("holds 7, drops the newest when full"), or null when no bound is known. */
export function queueLimit(q: QueueStatus): string | null {
  if (q.capacity === null && q.overflow === null) return null;
  const cap = q.capacity !== null ? `holds ${q.capacity}` : "default capacity";
  const over = q.overflow === "drop-newest" ? ", drops the newest when full" : q.overflow === "drop-oldest" ? ", drops the oldest when full" : "";
  return `${cap}${over}`;
}

/** How a recent-activity line reads, by kind. */
export function activityLabel(kind: ActivityRow["kind"]): { tone: "ok" | "warn" | "bad" | "neutral"; label: string } {
  switch (kind) {
    case "received": return { tone: "neutral", label: "Message in" };
    case "sent": return { tone: "ok", label: "Reply sent" };
    case "failed": return { tone: "bad", label: "Send failed" };
    case "queued": return { tone: "neutral", label: "Queued" };
    case "deferred": return { tone: "warn", label: "Deferred" };
    case "dropped": return { tone: "bad", label: "Dropped" };
    case "denied": return { tone: "warn", label: "Refused" };
    case "trigger": return { tone: "neutral", label: "Trigger" };
  }
}

/** Relative time for a timestamp, or "never". */
export const when = (ts: number | null | undefined, now: number = Date.now()): string => (ts ? formatRelativeTime(ts, now) : "never");

/** Counts for the page header: agents listening, channels connected, channels with a problem. */
export function overviewTotals(agents: readonly GatewayAgentStatus[]): { agents: number; listening: number; connected: number; problems: number } {
  let connected = 0;
  let problems = 0;
  for (const a of agents) {
    for (const c of a.gateway.channels) {
      if (!c.enabled) continue;
      if (c.state === "connected") connected++;
      else if (c.state === "failed" || c.state === "skipped") problems++;
    }
    if (a.gateway.phase === "failed") problems++;
  }
  return { agents: agents.length, listening: agents.filter((a) => a.gateway.phase === "running").length, connected, problems };
}
