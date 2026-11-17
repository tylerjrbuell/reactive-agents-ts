/**
 * One filter for Beacon, shared by the Board's Agents grid and the Field:
 * the status chips (All / Running / Needs you / Failed / Idle), a free-text
 * search over an agent's name, model, task and ids, and the remembered choice.
 * Both views read the same `BeaconFilter`, so a filter set on one tab holds on
 * the other. Pure; the components only render it.
 */
import type { StatusTone, StatusView } from "@reactive-agents/ui-core";
import type { AgentNode } from "./stores/agent-store.js";

/** A status chip. `running` is a Field chip only: the Board shows running agents as live cards. */
export type AgentFilter = "all" | "running" | "needs-you" | "failed" | "idle";

/** The Board's chips: agents at rest ("Idle" is every agent at rest that needs nothing: finished, stopped or idle). */
export const AGENT_FILTERS: readonly { readonly id: AgentFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "failed", label: "Failed" },
  { id: "idle", label: "Idle" },
];

/** The Field's chips: the Board's, plus Running. */
export const FIELD_FILTERS: readonly { readonly id: AgentFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "needs-you", label: "Needs you" },
  { id: "failed", label: "Failed" },
  { id: "idle", label: "Idle" },
];

/** Tones that are "at rest": the agent is not working and needs nothing. */
export const AT_REST: ReadonlySet<StatusTone> = new Set(["done", "stopped", "idle"]);

/** The status chip plus the search text. */
export interface BeaconFilter {
  readonly status: AgentFilter;
  readonly query: string;
}

/** No narrowing. */
export const NO_FILTER: BeaconFilter = { status: "all", query: "" };

/** True when the filter hides nothing. */
export const isNoFilter = (f: BeaconFilter): boolean => f.status === "all" && f.query.trim() === "";

/** Does an agent with this status tone pass the status chip? */
export function matchesFilter(tone: StatusTone, filter: AgentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return tone === "running";
    case "needs-you":
      return tone === "attention";
    case "failed":
      return tone === "failed";
    case "idle":
      return AT_REST.has(tone);
  }
}

/** Does the agent match the search? Every word must appear in the name, model, provider, task, saved-agent name or run id (case-insensitive). */
export function matchesQuery(node: AgentNode, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [node.name, node.displayName, node.savedAgentName, node.model, node.provider, node.task, node.runId]
    .filter((s): s is string => typeof s === "string")
    .join("\n")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The agents that pass both the chip and the search, in their given order. */
export function filterAgents(
  nodes: readonly AgentNode[],
  statusOf: (node: AgentNode) => StatusView,
  filter: BeaconFilter,
): AgentNode[] {
  if (isNoFilter(filter)) return [...nodes];
  return nodes.filter((n) => matchesFilter(statusOf(n).tone, filter.status) && matchesQuery(n, filter.query));
}

/** How many agents each chip would show (search applied), for the chip counts. */
export function filterCounts(
  nodes: readonly AgentNode[],
  statusOf: (node: AgentNode) => StatusView,
  query: string,
): Readonly<Record<AgentFilter, number>> {
  const counts: Record<AgentFilter, number> = { all: 0, running: 0, "needs-you": 0, failed: 0, idle: 0 };
  for (const n of nodes) {
    if (!matchesQuery(n, query)) continue;
    const tone = statusOf(n).tone;
    counts.all++;
    for (const id of ["running", "needs-you", "failed", "idle"] as const) if (matchesFilter(tone, id)) counts[id]++;
  }
  return counts;
}

/** `12 of 48` while narrowed, `48` otherwise. */
export function filterCountLabel(shown: number, total: number): string {
  return shown === total ? String(total) : `${shown} of ${total}`;
}

// ── Remembered choice ─────────────────────────────────────────────────

/** `localStorage` key for the last filter. */
export const BEACON_FILTER_KEY = "cortex.beacon.filter";

const STATUS_IDS: ReadonlySet<string> = new Set(FIELD_FILTERS.map((f) => f.id));

/** The stored filter; anything missing, blocked or malformed reads as no filter. */
export function readStoredFilter(storage: Pick<Storage, "getItem"> | null | undefined): BeaconFilter {
  try {
    const raw = storage?.getItem(BEACON_FILTER_KEY);
    if (!raw) return NO_FILTER;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return NO_FILTER;
    const { status, query } = v as { status?: unknown; query?: unknown };
    return {
      status: typeof status === "string" && STATUS_IDS.has(status) ? (status as AgentFilter) : "all",
      query: typeof query === "string" ? query.slice(0, 200) : "",
    };
  } catch {
    return NO_FILTER;
  }
}

/** Remember the filter; a blocked or full storage is ignored. */
export function storeFilter(storage: Pick<Storage, "setItem"> | null | undefined, filter: BeaconFilter): void {
  try {
    storage?.setItem(BEACON_FILTER_KEY, JSON.stringify(filter));
  } catch {
    /* the filter lasts for this page only */
  }
}
