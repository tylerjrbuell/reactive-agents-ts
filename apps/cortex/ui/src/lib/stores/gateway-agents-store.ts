/**
 * Lab saved agents (gateway + ad-hoc): the list, per-agent stats, and the REST calls
 * behind create / edit / run / pause / delete. The Lab page owns one instance so the
 * header count and the Agents tab read the same list.
 */
import { writable, type Readable } from "svelte/store";
import type { AgentConfig } from "../types/agent-config.js";

/** The fetch the store calls (injectable for tests). */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** One saved agent as the Lab lists it. */
export type GatewayRow = {
  agentId: string; name: string; config: AgentConfig;
  status: string; runCount: number; lastRunAt?: number; schedule?: string;
  agentType: "gateway" | "ad-hoc";
  processRunning?: boolean;
};

/** How a saved agent's status reads in the list: a kit Badge tone and a sentence-case label. */
export interface SavedAgentStatusView {
  readonly tone: "ok" | "warn" | "neutral" | "bad";
  readonly label: string;
}

/**
 * A saved agent's status badge: Active (green), Paused (amber), Stopped
 * (neutral); anything else (an error state the server reports) is red with
 * its own word, capitalised.
 */
export function savedAgentStatusOf(status: string): SavedAgentStatusView {
  switch (status) {
    case "active":
      return { tone: "ok", label: "Active" };
    case "paused":
      return { tone: "warn", label: "Paused" };
    case "stopped":
      return { tone: "neutral", label: "Stopped" };
    default:
      return { tone: "bad", label: status ? `${status[0]!.toUpperCase()}${status.slice(1)}` : "Unknown" };
  }
}

/** GET /api/agents/:id/stats. */
export type AgentStats = { runCount: number; successRate: number; avgTokens: number; totalCostUsd: number };

/** Store state. */
export interface GatewayAgentsState {
  readonly agents: GatewayRow[];
  readonly loading: boolean;
  readonly stats: Record<string, AgentStats>;
}

/** Body of POST /api/agents and PATCH /api/agents/:id. */
export type SaveAgentBody = {
  name: string;
  type: "gateway" | "ad-hoc";
  config: AgentConfig;
  schedule: string | null;
  runNow?: boolean;
};

/** The saved-agents store. */
export interface GatewayAgentsStore extends Readable<GatewayAgentsState> {
  /** Reload the list (each config merged over `defaults`); null when the request failed. */
  load(defaults: AgentConfig): Promise<GatewayRow[] | null>;
  loadStats(agentId: string): Promise<void>;
  /** Create (`editingId` null) or update an agent; throws on a non-2xx reply. */
  save(editingId: string | null, body: SaveAgentBody): Promise<{ runId?: string }>;
  /** Run an agent now; `data` is the parsed reply. */
  trigger(agentId: string, variableValues?: Record<string, string | number>): Promise<{ ok: boolean; status: number; data: { runId?: string; error?: string } }>;
  /** Pause an active agent, activate any other. */
  toggleStatus(agent: GatewayRow): Promise<void>;
  remove(agentId: string): Promise<boolean>;
  /** Delete several; resolves to the number that failed. */
  removeMany(agents: GatewayRow[]): Promise<number>;
}

/** Create the store. `fetchFn` is injectable for tests. */
export function createGatewayAgentsStore(serverUrl: string, fetchFn: FetchFn = (url, init) => fetch(url, init)): GatewayAgentsStore {
  const state = writable<GatewayAgentsState>({ agents: [], loading: false, stats: {} });
  const patch = (p: Partial<GatewayAgentsState>) => state.update((s) => ({ ...s, ...p }));
  const json = { "Content-Type": "application/json" };

  return {
    subscribe: state.subscribe,

    async load(defaults) {
      patch({ loading: true });
      try {
        const agentsRes = await fetchFn(`${serverUrl}/api/agents`);
        const agentsRaw = agentsRes.ok ? (await agentsRes.json() as Array<Omit<GatewayRow, "agentType"> & { type?: "gateway" | "ad-hoc" }>) : [];
        const mapped: GatewayRow[] = agentsRaw.map((agent) => ({
          ...agent,
          config: { ...defaults, ...(agent.config ?? {}) },
          agentType:
            agent.type === "ad-hoc" || agent.agentId.startsWith("agent-") ? "ad-hoc" : "gateway",
        }));
        patch({ agents: mapped });
        return mapped;
      } catch {
        patch({ agents: [] });
        return null;
      } finally {
        patch({ loading: false });
      }
    },

    async loadStats(agentId) {
      try {
        const res = await fetchFn(`${serverUrl}/api/agents/${encodeURIComponent(agentId)}/stats`);
        if (res.ok) {
          const data: unknown = await res.json();
          if (data && typeof data === "object") state.update((s) => ({ ...s, stats: { ...s.stats, [agentId]: data as AgentStats } }));
        }
      } catch { /* ignore */ }
    },

    async save(editingId, body) {
      const url = editingId ? `${serverUrl}/api/agents/${editingId}` : `${serverUrl}/api/agents`;
      const res = await fetchFn(url, { method: editingId ? "PATCH" : "POST", headers: json, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      return await res.json() as { runId?: string };
    },

    async trigger(agentId, variableValues) {
      const res = await fetchFn(`${serverUrl}/api/agents/${agentId}/trigger`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(variableValues ? { variableValues } : {}),
      });
      const data = await res.json() as { runId?: string; error?: string };
      return { ok: res.ok, status: res.status, data };
    },

    async toggleStatus(agent) {
      const newStatus = agent.status === "active" ? "paused" : "active";
      await fetchFn(`${serverUrl}/api/agents/${agent.agentId}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ status: newStatus }),
      });
    },

    async remove(agentId) {
      const res = await fetchFn(`${serverUrl}/api/agents/${agentId}`, { method: "DELETE" });
      return res.ok;
    },

    async removeMany(agents) {
      try {
        const oks = await Promise.all(
          agents.map((agent) =>
            fetchFn(`${serverUrl}/api/agents/${agent.agentId}`, { method: "DELETE" })
              .then((r) => r.ok)
              .catch(() => false),
          ),
        );
        return oks.filter((ok) => !ok).length;
      } catch {
        return agents.length;
      }
    },
  };
}

/** Agents tab view state the Lab page keeps across tab switches (edit form, selection, running trigger). */
export type SavedAgentsUi<C extends AgentConfig = AgentConfig> = {
  showForm: boolean;
  editingAgent: GatewayRow | null;
  formConfig: C;
  formName: string;
  formSchedule: string;
  formAgentType: "gateway" | "ad-hoc";
  formSaving: boolean;
  triggeringAgent: string | null;
  selected: Set<string>;
};

/** Selection kept to agents still in the list. */
export function pruneSelection(selected: ReadonlySet<string>, agents: readonly GatewayRow[]): Set<string> {
  return new Set([...selected].filter((id) => agents.some((a) => a.agentId === id)));
}

/** Confirm text for deleting several agents (first six named). */
export function bulkDeleteConfirmMessage(agents: readonly GatewayRow[]): string {
  const max = 6;
  const lines = agents
    .slice(0, max)
    .map((a) => `· ${a.name}`)
    .join("\n");
  const more =
    agents.length > max ? `\n… and ${agents.length - max} more` : "";
  return `This permanently deletes ${agents.length} saved agent${agents.length === 1 ? "" : "s"} and their configurations. This cannot be undone.\n\n${lines}${more}`;
}
