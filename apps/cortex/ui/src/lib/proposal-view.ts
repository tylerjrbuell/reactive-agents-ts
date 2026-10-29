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
}

/** Which UI stores an applied action can change and so must re-read. */
export type ProposalEffect = "goal" | "schedules" | "config";

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
  const chips = argChips(p.args);
  const error = p.status === "proposed" && p.error ? p.error : null;
  switch (p.status) {
    case "applied":
      return { summary: p.summary, chips, pending: false, statusLabel: "Applied", tone: "ok", error: null };
    case "dismissed":
      return { summary: p.summary, chips, pending: false, statusLabel: "Dismissed", tone: "muted", error: null };
    case "proposed":
      return {
        summary: p.summary,
        chips,
        pending: true,
        statusLabel: error ? "Apply failed" : null,
        tone: error ? "error" : "pending",
        error,
      };
  }
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
  if (a.includes("model") || a.includes("provider") || a.includes("config") || a.includes("thinking") || a.includes("skill") || a.includes("doc")) return ["config"];
  return ["goal", "schedules", "config"];
}

/** Session config flag: let the agent propose changes to this chat. Default off. */
export const agentControlEnabled = (cfg: Readonly<Record<string, unknown>>): boolean => cfg.agentControl === true;

export const toggleAgentControlPatch = (cfg: Readonly<Record<string, unknown>>): { agentControl: boolean } => ({
  agentControl: !agentControlEnabled(cfg),
});
