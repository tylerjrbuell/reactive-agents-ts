/**
 * Pure view logic for agent-session-control proposals: wire types (mirroring the server's
 * `GET /api/chat/sessions/:id/proposals`), the display model behind `ChatProposalCard`, the
 * poll gate, and the session-config flag. No I/O. A proposal never mutates anything until the
 * user clicks Apply; the server enforces that, this file only describes it.
 */

export type ProposalStatus = "proposed" | "applied" | "dismissed";

export interface ProposalWire {
  readonly id: string;
  readonly action: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly status: ProposalStatus;
  readonly createdAt: number;
  /** Set when an Apply failed; the status stays `proposed` so the user can retry or dismiss. */
  readonly error?: string;
  /** Before -> after rows for config changes. */
  readonly diff?: readonly ProposalDiffRow[];
  readonly direction?: "tighten" | "loosen" | "neutral";
  /** Outside content may have steered this proposal. */
  readonly flag?: string;
  /** `auto` when a tightening change the user allowed applied without a click. */
  readonly appliedBy?: "user" | "auto";
}

/** One before -> after row. */
export interface ProposalDiffRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** Which UI stores an applied action can change and so must re-read. */
export type ProposalEffect = "goal" | "schedules" | "config" | "history";

export interface ProposalChip {
  readonly key: string;
  readonly value: string;
}

export interface ProposalView {
  readonly summary: string;
  readonly chips: readonly ProposalChip[];
  readonly pending: boolean;
  readonly statusLabel: string | null;
  readonly tone: "pending" | "ok" | "muted" | "error";
  readonly error: string | null;
  readonly diff: readonly ProposalDiffRow[];
  /** Warning shown above Apply, or null. */
  readonly flag: string | null;
  /** Applied or dismissed: drawn as a one-line row with a remove control. */
  readonly settled: boolean;
  /** Short note on how it settled ("Applied automatically" etc.), or null. */
  readonly note: string | null;
  /** Loosening changes get an explicit marker on the card. */
  readonly loosens: boolean;
}

const MAX_VALUE = 40;

const clip = (s: string): string => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);

function chipValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : clip(v.trim());
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return clip(JSON.stringify(v));
  } catch {
    return null;
  }
}

/** One chip per non-empty arg, in the order the server sent them. */
export function argChips(args: Readonly<Record<string, unknown>>): readonly ProposalChip[] {
  const out: ProposalChip[] = [];
  for (const [key, raw] of Object.entries(args)) {
    const value = chipValue(raw);
    if (value !== null) out.push({ key, value });
  }
  return out;
}

export function proposalView(p: ProposalWire): ProposalView {
  // A diff row already says what the arg chips would, so chips only show without one.
  const diff = p.diff ?? [];
  const chips = diff.length > 0 ? [] : argChips(p.args);
  const error = p.status === "proposed" && p.error ? p.error : null;
  const base = { summary: p.summary, chips, diff, loosens: p.direction === "loosen" };
  switch (p.status) {
    case "applied":
      return { ...base, pending: false, statusLabel: "Applied", tone: "ok", error: null, flag: null, settled: true, note: p.appliedBy === "auto" ? "Applied automatically (a stricter change you allowed)" : null };
    case "dismissed":
      return { ...base, pending: false, statusLabel: "Dismissed", tone: "muted", error: null, flag: null, settled: true, note: null };
    case "proposed":
      return {
        ...base,
        pending: true,
        statusLabel: error ? "Apply failed" : null,
        tone: error ? "error" : "pending",
        error,
        flag: p.flag ?? null,
        settled: false,
        note: null,
      };
  }
}

/**
 * The banners to draw: identical proposals (same action, args and status) collapse to the newest,
 * so a repeated tool call never stacks duplicate cards. Order is kept.
 */
export function visibleProposals(list: readonly ProposalWire[]): readonly ProposalWire[] {
  const newest = new Map<string, string>();
  for (const p of list) newest.set(`${p.status}|${p.action}|${JSON.stringify(p.args)}`, p.id);
  return list.filter((p) => newest.get(`${p.status}|${p.action}|${JSON.stringify(p.args)}`) === p.id);
}

/**
 * Poll while an unresolved proposal exists or a turn is streaming (a streaming turn may
 * create one). Once everything is resolved and the turn is idle, stop.
 */
export function shouldPollProposals(proposals: readonly ProposalWire[], streaming: boolean): boolean {
  return streaming || proposals.some((p) => p.status === "proposed");
}

/** Which stores to refresh after an applied action. Unknown actions refresh everything (cheap, safe). */
export function effectsOf(action: string): readonly ProposalEffect[] {
  const a = action.toLowerCase();
  if (a.includes("goal")) return ["goal"];
  if (a.includes("loop") || a.includes("schedule") || a.includes("cron")) return ["schedules"];
  if (a === "compact" || a === "fork" || a === "rewind" || a === "set-todo") return ["history", "config"];
  if (a.includes("model") || a.includes("provider") || a.includes("config") || a.includes("thinking") || a.includes("skill") || a.includes("doc")) return ["config"];
  if (["add-tool", "remove-tool", "enable-mcp-server", "set-max-iterations", "set-strategy", "set-context-budget", "set-memory", "set-system-prompt", "set-approval-policy", "set-workspace"].includes(a)) return ["config"];
  return ["goal", "schedules", "config"];
}

/** Session config flag: let the agent propose changes to this chat. Default off. */
export const agentControlEnabled = (cfg: Readonly<Record<string, unknown>>): boolean => cfg.agentControl === true;

export const toggleAgentControlPatch = (cfg: Readonly<Record<string, unknown>>): { agentControl: boolean } => ({
  agentControl: !agentControlEnabled(cfg),
});
