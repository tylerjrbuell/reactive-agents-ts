/**
 * Pure rules for the Runs table (`routes/runs/+page.svelte`, Bench spec section
 * 8): search, the status segment, sort, the pinned and recent groups, totals,
 * the source of a run and how a live event updates a row. Status goes through
 * ui-core's one vocabulary (`statusOfRun`).
 */
import { statusOfRun, turnOutcomeOf, type StatusTone, type StatusView } from "@reactive-agents/ui-core";
import { runStatusAfter } from "./run-live-status.js";
import { isIdLike, runHeaderStatus, shortRunId } from "./run-view.js";

/** One row of `GET /api/runs` as the table holds it. */
export interface RunRow {
  readonly runId: string;
  readonly agentId: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly status: string;
  /** How the run ended (server `cortex_runs.ending`, ui-core `TurnEnding`): `abstained` and `partial` runs are `failed` by status. */
  readonly ending?: string;
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly hasDebrief: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: string;
  readonly displayName?: string;
  /** Linked saved agent (`cortex_agents.name`). */
  readonly agentRecordName?: string;
  /** Set for runs a chat session started (and their sub-agent runs). */
  readonly chatSessionId?: string;
  readonly chatSessionName?: string;
  /** Desk-run launch snapshot. */
  readonly launchParams?: Readonly<Record<string, unknown>>;
  readonly parentRunId?: string;
}

/** The two endings that end `failed` by status but are not failures. */
function quietEnding(ending: string | undefined): "abstained" | "partial" | undefined {
  return ending === "abstained" || ending === "partial" ? ending : undefined;
}

/**
 * The status a run row shows: the shared run vocabulary, except that a run that
 * abstained or ended partial reads so (attention, not a red Failed), the same
 * rule as the run view header (`runHeaderStatus`). Beacon uses it too.
 */
export function runRowStatus(row: { readonly status: string; readonly ending?: string }): StatusView {
  return runHeaderStatus(row.status, quietEnding(row.ending));
}

/** The status segment: every run, one tone of the shared vocabulary, or the runs the framework can continue (`resumable`). */
export type RunStatusFilter = "all" | Exclude<StatusTone, "idle"> | "resumable";

/** Segment order and labels (sentence case, spec section 6). */
export const RUN_STATUS_FILTERS: readonly { readonly id: RunStatusFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "attention", label: "Waiting" },
  { id: "done", label: "Finished" },
  { id: "failed", label: "Failed" },
  { id: "stopped", label: "Stopped" },
  { id: "resumable", label: "Can continue" },
];

/** No run ids: the default for the resumable set (a list that has not loaded offers nothing). */
const NO_RUNS: ReadonlySet<string> = new Set();

/** Sort orders the table offers. */
export type RunSort = "started-desc" | "started-asc" | "tokens-desc" | "cost-desc";

/** Sort options (value, label). */
export const RUN_SORTS: readonly { readonly value: RunSort; readonly label: string }[] = [
  { value: "started-desc", label: "Newest first" },
  { value: "started-asc", label: "Oldest first" },
  { value: "tokens-desc", label: "Most tokens" },
  { value: "cost-desc", label: "Highest cost" },
];

/** Where a run came from: a chat turn, a saved agent (gateway), a desk run (Lab / Beacon), or any other app. */
export type RunSource = "chat" | "agent" | "desk" | "app";

/** How the table names each source. */
export const RUN_SOURCE_LABEL: Readonly<Record<RunSource, string>> = { chat: "chat", agent: "gateway", desk: "desk run", app: "app" };

/** A run's source, from what the server knows about it. */
export function runSourceOf(row: RunRow): RunSource {
  if (row.chatSessionId) return "chat";
  if (row.agentRecordName) return "agent";
  if (row.launchParams) return "desk";
  return "app";
}

/**
 * The run's name in the table: its label, else the chat it came from, else its
 * short id. A label that is only an id (a chat agent's ULID, the agent id) is
 * not a name (spec 3.2: runs were identified by ULID).
 */
export function runNameOf(row: RunRow): string {
  const label = row.displayName?.trim();
  const named = label && !isIdLike(label) && label !== row.agentId ? label : undefined;
  return named || row.chatSessionName?.trim() || `Run ${shortRunId(row.runId)}`;
}

const lc = (s: string | undefined): string => (s ?? "").toLowerCase();

/** Rows matching the search text (id, agent, name, chat, provider, model, strategy) and the status segment. */
export function filterRuns(rows: readonly RunRow[], search: string, status: RunStatusFilter, resumable: ReadonlySet<string> = NO_RUNS): RunRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (status === "resumable" ? !resumable.has(r.runId) : status !== "all" && runRowStatus(r).tone !== status) return false;
    if (!q) return true;
    return [r.runId, r.agentId, r.displayName, r.chatSessionName, r.agentRecordName, r.provider, r.model, r.strategy].some((f) =>
      lc(f).includes(q),
    );
  });
}

/** Rows in `sort` order (ties broken newest first). */
export function sortRuns(rows: readonly RunRow[], sort: RunSort): RunRow[] {
  const out = [...rows];
  const newest = (a: RunRow, b: RunRow) => b.startedAt - a.startedAt;
  switch (sort) {
    case "started-asc":
      return out.sort((a, b) => a.startedAt - b.startedAt);
    case "tokens-desc":
      return out.sort((a, b) => b.tokensUsed - a.tokensUsed || newest(a, b));
    case "cost-desc":
      return out.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || newest(a, b));
    default:
      return out.sort(newest);
  }
}

/** The table's two groups: pinned runs first, then the rest, each in the given order. */
export function groupRuns(rows: readonly RunRow[], pinned: ReadonlySet<string>): { readonly pinned: RunRow[]; readonly recent: RunRow[] } {
  return { pinned: rows.filter((r) => pinned.has(r.runId)), recent: rows.filter((r) => !pinned.has(r.runId)) };
}

/** Run count per segment. */
export function statusCounts(rows: readonly RunRow[], resumable: ReadonlySet<string> = NO_RUNS): Record<RunStatusFilter, number> {
  const counts: Record<RunStatusFilter, number> = { all: rows.length, running: 0, attention: 0, done: 0, failed: 0, stopped: 0, resumable: 0 };
  for (const r of rows) {
    const tone = runRowStatus(r).tone;
    if (tone !== "idle") counts[tone]++;
    if (resumable.has(r.runId)) counts.resumable++;
  }
  return counts;
}

/** Token and cost totals over `rows`. */
export function runTotals(rows: readonly RunRow[]): { readonly tokens: number; readonly cost: number } {
  let tokens = 0;
  let cost = 0;
  for (const r of rows) {
    tokens += r.tokensUsed;
    cost += r.cost ?? 0;
  }
  return { tokens, cost };
}

/** How long the run took (or has run so far, when it is live); `undefined` when unknown. */
export function runDurationMs(row: RunRow, now: number): number | undefined {
  if (row.completedAt !== undefined) return Math.max(0, row.completedAt - row.startedAt);
  return statusOfRun(row.status).tone === "running" ? Math.max(0, now - row.startedAt) : undefined;
}

/** A live message on the broadcast socket. */
export interface RunLiveMessage {
  readonly agentId?: string;
  readonly runId?: string;
  readonly type?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly ts?: number;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function tokensOf(p: Readonly<Record<string, unknown>>): number {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") return num((raw as { total?: unknown }).total) ?? 0;
  return 0;
}

/**
 * Fold one live message into the rows. A message for an unknown run adds a
 * live row at the top. Status follows the server's rules (`runStatusAfter`: a
 * stopped run that then reports a failure stays stopped). Returns the same
 * array when nothing changed.
 */
export function applyRunLiveMessage(rows: readonly RunRow[], msg: RunLiveMessage, now: number): readonly RunRow[] {
  if (!msg.agentId || !msg.runId || !msg.type) return rows;
  const p = msg.payload ?? {};
  const idx = rows.findIndex((r) => r.runId === msg.runId);
  const base: RunRow =
    idx >= 0
      ? rows[idx]!
      : {
          runId: msg.runId,
          agentId: msg.agentId,
          startedAt: num(p.startedAt) ?? num(msg.ts) ?? now,
          status: "live",
          iterationCount: 0,
          tokensUsed: 0,
          cost: 0,
          hasDebrief: false,
        };
  let patch: Partial<RunRow> = {};
  switch (msg.type) {
    case "AgentStarted":
      patch = { ...(text(p.provider) ? { provider: text(p.provider) } : {}), ...(text(p.model) ? { model: text(p.model) } : {}) };
      break;
    case "ReasoningIterationProgress": {
      const iter = num(p.iteration);
      patch = {
        ...(iter !== undefined && iter > base.iterationCount ? { iterationCount: iter } : {}),
        ...(!base.strategy && text(p.strategy) ? { strategy: text(p.strategy) } : {}),
      };
      break;
    }
    case "LLMRequestCompleted": {
      const tokens = tokensOf(p);
      const cost = num(p.estimatedCost) ?? 0;
      if (tokens > 0 || cost > 0) patch = { tokensUsed: base.tokensUsed + tokens, cost: base.cost + cost };
      break;
    }
    case "AgentCompleted":
    case "TaskFailed":
    case "ExecutionCancelled":
    case "AgentStopped":
    case "AgentTerminated": {
      const status = runStatusAfter(base.status, msg.type, p);
      const total = msg.type === "AgentCompleted" ? num(p.totalTokens) : undefined;
      const duration = msg.type === "AgentCompleted" ? num(p.durationMs) : undefined;
      patch = {
        ...(status !== undefined ? { status, completedAt: duration !== undefined ? base.startedAt + duration : now } : {}),
        // The same classifier the server stores on `cortex_runs.ending`.
        ...(msg.type === "AgentCompleted" ? { ending: turnOutcomeOf(p).ending } : {}),
        ...(total !== undefined && total > base.tokensUsed ? { tokensUsed: total } : {}),
      };
      break;
    }
    case "DebriefCompleted":
      if (!base.hasDebrief) patch = { hasDebrief: true };
      break;
  }
  if (idx >= 0 && Object.keys(patch).length === 0) return rows;
  const next: RunRow = { ...base, ...patch };
  if (idx < 0) return [next, ...rows];
  const out = [...rows];
  out[idx] = next;
  return out;
}
