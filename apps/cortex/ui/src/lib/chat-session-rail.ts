/**
 * The chat sessions rail (Bench spec section 8, Chat): sessions newest first,
 * filtered by the search box, grouped into Today and Earlier, each with its
 * model and a relative time (ui-core `formatRelativeTime`). Pure, so the rail
 * and its test share it.
 */
import { formatRelativeTime } from "@reactive-agents/ui-core";

/** The session fields the rail reads. */
export interface RailSession {
  readonly sessionId: string;
  readonly name: string;
  readonly lastUsedAt: number;
  readonly agentConfig: Record<string, unknown>;
}

/** One row of the rail. */
export interface RailRow {
  readonly sessionId: string;
  readonly name: string;
  /** The session's model (`agentConfig.model`), or "" when none is set. */
  readonly model: string;
  /** `3 minutes ago`, `yesterday`, `Nov 8`. */
  readonly when: string;
  /** Absolute time for the hover title. */
  readonly whenTitle: string;
}

/** A labelled group of rows. Empty groups are left out. */
export interface RailGroup {
  readonly label: "Today" | "Earlier";
  readonly rows: readonly RailRow[];
}

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Case-insensitive match of the search text against the name and the model. */
export function railMatches(s: RailSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const model = typeof s.agentConfig.model === "string" ? s.agentConfig.model : "";
  return s.name.toLowerCase().includes(q) || model.toLowerCase().includes(q);
}

/** Group the sessions for the rail: newest first, filtered by `query`, Today then Earlier. */
export function sessionRailGroups(sessions: readonly RailSession[], now: number, query = ""): RailGroup[] {
  const today = startOfDay(now);
  const rows = [...sessions]
    .filter((s) => railMatches(s, query))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((s) => ({
      group: s.lastUsedAt >= today ? ("Today" as const) : ("Earlier" as const),
      row: {
        sessionId: s.sessionId,
        name: s.name,
        model: typeof s.agentConfig.model === "string" ? s.agentConfig.model : "",
        when: formatRelativeTime(s.lastUsedAt, Math.max(now, s.lastUsedAt)),
        whenTitle: new Date(s.lastUsedAt).toLocaleString(),
      },
    }));
  return (["Today", "Earlier"] as const)
    .map((label) => ({ label, rows: rows.filter((r) => r.group === label).map((r) => r.row) }))
    .filter((g) => g.rows.length > 0);
}
