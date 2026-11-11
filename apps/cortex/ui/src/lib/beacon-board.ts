/**
 * Pure rules for Beacon (`routes/+page.svelte`, Bench spec section 8): which
 * view opens (Board or Field), what each agent's status is, the Board's
 * "Running now" cards and filtered Agents grid, and the Field's node labels,
 * icons and links. Status goes through ui-core's one vocabulary
 * (`statusOfRun`); Beacon adds only "Waiting on you" for a run paused on an
 * approval or a question.
 */
import { formatCost, formatTokens, type PendingInteractionWire, type StatusTone, type StatusView } from "@reactive-agents/ui-core";
import type { IconName } from "./icons.js";
import type { AgentNode } from "./stores/agent-store.js";
import { runErrorLine } from "./run-error.js";
import { RUN_SOURCE_LABEL, runRowStatus, type RunSource } from "./runs-table.js";
import { approvalDetail, waitingRunsOf, type PendingApprovalWire } from "./waiting-on-you.js";

// ── View (Board / Field) ──────────────────────────────────────────────

/** Beacon's two views: Board (default, owner decision 4) and Field (the free canvas). */
export type BeaconView = "board" | "field";

/** `localStorage` key for the last view the user picked. */
export const BEACON_VIEW_KEY = "cortex.beacon.view";

/** A view name, or `undefined` for anything else. */
export function parseBeaconView(raw: string | null | undefined): BeaconView | undefined {
  return raw === "board" || raw === "field" ? raw : undefined;
}

/** The view to open: the URL's `?view=` wins, then the stored choice, then Board. */
export function resolveBeaconView(urlParam: string | null | undefined, stored: string | null | undefined): BeaconView {
  return parseBeaconView(urlParam) ?? parseBeaconView(stored) ?? "board";
}

/** The stored view; `undefined` when storage is missing, blocked or holds something else. */
export function readStoredBeaconView(storage: Pick<Storage, "getItem"> | null | undefined): BeaconView | undefined {
  try {
    return parseBeaconView(storage?.getItem(BEACON_VIEW_KEY));
  } catch {
    return undefined;
  }
}

/** Remember the view; a blocked or full storage is ignored (the URL still carries it). */
export function storeBeaconView(storage: Pick<Storage, "setItem"> | null | undefined, view: BeaconView): void {
  try {
    storage?.setItem(BEACON_VIEW_KEY, view);
  } catch {
    /* private mode or quota: the choice lasts for this page only */
  }
}

/** `search` (with or without `?`) with `view` set: Field adds `view=field`, Board drops the parameter. */
export function beaconViewSearch(search: string, view: BeaconView): string {
  const params = new URLSearchParams(search);
  if (view === "field") params.set("view", "field");
  else params.delete("view");
  const s = params.toString();
  return s ? `?${s}` : "";
}

// ── Status ────────────────────────────────────────────────────────────

/** True while the agent works (any live cognitive state). */
export function isLiveNode(node: Pick<AgentNode, "state">): boolean {
  return node.state === "running" || node.state === "exploring" || node.state === "stressed";
}

/** The run's summary status: the one the server reported, else read from the cognitive state. */
function runStatusOf(node: AgentNode): string {
  if (node.runStatus) return node.runStatus;
  if (isLiveNode(node)) return "live";
  return node.state === "error" ? "failed" : node.state === "completed" ? "completed" : "idle";
}

/**
 * One agent's status on Beacon: "Waiting on you" (the shared vocabulary; the
 * filter chip that finds these reads "Needs you") while it waits on an approval or a
 * question, "Running" while it works, else the run vocabulary (Finished,
 * Failed, Stopped).
 */
export function beaconStatusOf(node: AgentNode, needsYou: boolean): StatusView {
  if (needsYou) return { tone: "attention", label: "Waiting on you" };
  if (isLiveNode(node)) return { tone: "running", label: "Running" };
  // An abstained or partial run reads so (attention), not a red Failed: the Runs table's rule.
  const view = runRowStatus({ status: runStatusOf(node), ...(node.runEnding ? { ending: node.runEnding } : {}) });
  return view.tone === "idle" ? { tone: "idle", label: "Idle" } : view;
}

/** Where the run came from (the same rule and labels as the Runs table). */
export function beaconSourceOf(node: AgentNode): RunSource {
  if (node.chatSessionId) return "chat";
  if (node.savedAgentName) return "agent";
  if (node.launched) return "desk";
  return "app";
}

/** The source's short label (`chat`, `gateway`, `desk run`, `app`). */
export function beaconSourceLabel(node: AgentNode): string {
  return RUN_SOURCE_LABEL[beaconSourceOf(node)];
}

const firstLine = (s: string): string => s.trim().split("\n")[0]?.trim() ?? "";

/**
 * What each waiting run is waiting for, by Cortex run id: `Asked: <question>`
 * or `Approve <tool>: <args>`. A desk or gateway approval carries the durable
 * run id, so it falls back to the newest run of the same agent; a chat
 * approval falls back to the newest run of its chat session.
 */
export function needsYouByRun(
  nodes: readonly AgentNode[],
  approvals: readonly PendingApprovalWire[],
  interactions: readonly PendingInteractionWire[],
): ReadonlyMap<string, string> {
  const refs = nodes.map((n) => ({ ...n, startedAt: startOf(n) }));
  const out = new Map<string, string>();
  for (const [runId, w] of waitingRunsOf(refs, approvals, interactions)) {
    if (w.kind === "approval") {
      const detail = approvalDetail(w.approval.args);
      out.set(runId, `Approve ${w.approval.toolName || "a tool call"}${detail ? `: ${detail}` : ""}`);
    } else {
      out.set(runId, `Asked: ${firstLine(w.interaction.prompt)}`);
    }
  }
  return out;
}

// ── Board ─────────────────────────────────────────────────────────────

/** The Agents grid's filter chips. */
export type AgentFilter = "all" | "needs-you" | "failed" | "idle";

/** Chip order and labels. "Idle" is every agent at rest that needs nothing: finished, stopped or idle. */
export const AGENT_FILTERS: readonly { readonly id: AgentFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "failed", label: "Failed" },
  { id: "idle", label: "Idle" },
];

const AT_REST: ReadonlySet<StatusTone> = new Set(["done", "stopped", "idle"]);

function matchesFilter(tone: StatusTone, filter: AgentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs-you":
      return tone === "attention";
    case "failed":
      return tone === "failed";
    case "idle":
      return AT_REST.has(tone);
  }
}

/** What a live card says the agent is doing now. */
export interface LiveActivity {
  readonly verb: "Calling" | "Thinking" | "Starting";
  /** The tool being called (`Calling`). */
  readonly tool?: string;
  /** Muted detail after the verb (`after 14 tool calls`). */
  readonly detail?: string;
}

/** One "Running now" card. */
export interface LiveCard {
  readonly runId: string;
  readonly name: string;
  readonly source: string;
  /** Run time so far, when the start is known. */
  readonly elapsedMs?: number;
  /** The task, first line. */
  readonly goal?: string;
  readonly activity: LiveActivity;
  /** Entropy per scored step, 0..1. */
  readonly entropy: readonly number[];
  /** Kernel loop and its cap (`max` 0 when unknown). */
  readonly loop: number;
  readonly max: number;
  /** `step 3 of 6 · 2.1k tok · $0.31`. */
  readonly foot: string;
}

/** One card in the Agents grid. */
export interface AgentRow {
  readonly runId: string;
  readonly name: string;
  readonly status: StatusView;
  readonly source: string;
  /** The question or approval it waits on, its error, its task, or empty. */
  readonly last: string;
  readonly model?: string;
  readonly tokens?: string;
  /** When it last did something (ms epoch), for a relative time. */
  readonly at?: number;
}

/** The whole Board. `counts` are per filter over every agent at rest. */
export interface BoardModel {
  readonly live: readonly LiveCard[];
  readonly agents: readonly AgentRow[];
  readonly counts: Readonly<Record<AgentFilter, number>>;
  /** Agents at rest before the filter. */
  readonly total: number;
}

function startOf(n: AgentNode): number {
  return n.startedAt ?? n.connectedAt ?? 0;
}

/** What the agent is doing now: calling a tool, thinking, or starting (no loop yet). */
export function liveActivityOf(node: AgentNode): LiveActivity {
  if (node.currentTool) return { verb: "Calling", tool: node.currentTool };
  const calls = node.toolCalls ?? 0;
  if (node.loopIteration > 0 || node.reasoningSteps > 0 || calls > 0) {
    return calls > 0 ? { verb: "Thinking", detail: `after ${calls} tool call${calls === 1 ? "" : "s"}` } : { verb: "Thinking" };
  }
  return { verb: "Starting" };
}

/** `step 3 of 6 · 2.1k tok · $0.310` (ui-core formatters); parts with no data are left out. */
export function liveFootOf(node: AgentNode): string {
  const parts: string[] = [];
  if (node.loopIteration > 0) parts.push(node.maxIterations > 0 ? `step ${node.loopIteration} of ${node.maxIterations}` : `step ${node.loopIteration}`);
  if (node.tokensUsed > 0) parts.push(`${formatTokens(node.tokensUsed)} tok`);
  if (node.cost > 0) parts.push(formatCost(node.cost));
  return parts.join(" · ");
}

function lastLineOf(node: AgentNode, status: StatusView, waiting: string | undefined): string {
  if (waiting) return waiting;
  if (status.tone === "failed" || status.tone === "stopped") {
    const cause = runErrorLine(node.errorMessage);
    if (cause) return cause;
  }
  if (node.task) return firstLine(node.task);
  if (status.tone === "stopped") return "Stopped before it finished";
  return "";
}

/**
 * The Board: live agents as cards (oldest first, so cards keep their place),
 * then every other agent in the grid, waiting ones first, then newest first,
 * narrowed by `filter`. An agent waiting on you is never a live card.
 */
export function boardOf(
  nodes: readonly AgentNode[],
  needsYou: ReadonlyMap<string, string>,
  filter: AgentFilter,
  now: number,
): BoardModel {
  const live: LiveCard[] = [];
  const rest: { row: AgentRow; at: number }[] = [];
  for (const node of nodes) {
    const waiting = needsYou.get(node.runId);
    const status = beaconStatusOf(node, waiting !== undefined);
    if (status.tone === "running") {
      const start = startOf(node);
      live.push({
        runId: node.runId,
        name: node.name,
        source: beaconSourceLabel(node),
        ...(start > 0 ? { elapsedMs: Math.max(0, now - start) } : {}),
        ...(node.task ? { goal: firstLine(node.task) } : {}),
        activity: liveActivityOf(node),
        entropy: node.entropyHistory ?? (node.entropy > 0 ? [node.entropy] : []),
        loop: node.loopIteration,
        max: node.maxIterations,
        foot: liveFootOf(node),
      });
      continue;
    }
    const at = node.completedAt ?? (node.lastEventAt > 0 ? node.lastEventAt : startOf(node));
    rest.push({
      at,
      row: {
        runId: node.runId,
        name: node.name,
        status,
        source: beaconSourceLabel(node),
        last: lastLineOf(node, status, waiting),
        ...(node.model ? { model: node.model } : {}),
        ...(node.tokensUsed > 0 ? { tokens: `${formatTokens(node.tokensUsed)} tok` } : {}),
        ...(at > 0 ? { at } : {}),
      },
    });
  }
  live.sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0) || a.runId.localeCompare(b.runId));
  rest.sort((a, b) => {
    const wa = a.row.status.tone === "attention" ? 0 : 1;
    const wb = b.row.status.tone === "attention" ? 0 : 1;
    return wa - wb || b.at - a.at || a.row.runId.localeCompare(b.row.runId);
  });
  const counts: Record<AgentFilter, number> = { all: rest.length, "needs-you": 0, failed: 0, idle: 0 };
  for (const { row } of rest) {
    if (row.status.tone === "attention") counts["needs-you"]++;
    else if (row.status.tone === "failed") counts.failed++;
    else if (AT_REST.has(row.status.tone)) counts.idle++;
  }
  return {
    live,
    agents: rest.filter(({ row }) => matchesFilter(row.status.tone, filter)).map(({ row }) => row),
    counts,
    total: rest.length,
  };
}

// ── Field ─────────────────────────────────────────────────────────────

/** A Field node's sentence-case status line: `Calling http-get`, `Running · step 3`, `Finished`. */
export function fieldStatusLabel(node: AgentNode, status: StatusView): string {
  if (status.tone !== "running") return status.label;
  if (node.currentTool) return `Calling ${node.currentTool}`;
  return node.loopIteration > 0 ? `Running · step ${node.loopIteration}` : "Running";
}

/** The icon on a Field node's tile. */
export function fieldIconOf(node: AgentNode, tone: StatusTone): IconName {
  switch (tone) {
    case "running":
      return node.currentTool ? "tool" : "think";
    case "done":
      return "check";
    case "failed":
      return "alert";
    case "attention":
      return "info";
    case "stopped":
      return "stop";
    case "idle":
      return "steps";
  }
}

/** A parent-to-sub-agent link flows only while both ends run (spec 5.2). */
export function fieldLinkActive(parent: Pick<AgentNode, "state"> | undefined, child: Pick<AgentNode, "state">): boolean {
  return parent !== undefined && isLiveNode(parent) && isLiveNode(child);
}

/**
 * The top bar's running count: agents working now, the same set as the
 * Board's "Running now" (an agent waiting on you is not running).
 */
export function runningCount(
  nodes: readonly Pick<AgentNode, "state" | "runId">[],
  needsYou: ReadonlyMap<string, string> = new Map(),
): number {
  let n = 0;
  for (const node of nodes) if (isLiveNode(node) && !needsYou.has(node.runId)) n++;
  return n;
}
