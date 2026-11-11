import type { GoalStatus } from "./goal-checks.js";
import { failureReason, shortToolName, type StepCall } from "./turn-steps.js";
import type { TurnEnding } from "./turn-outcome.js";
import { formatTurnDuration } from "./turn-duration.js";

/**
 * Compact card for one sub-agent, the way modern agent chats show background
 * agents: name, a status dot, tools used, duration, cost, ONE muted line of
 * what it is doing (or found), and its goal status as an icon. The detail (its
 * own transcript) belongs in a drill-in panel, never inline. Pure: the card
 * never prints raw tool arguments, only a short human hint drawn from them.
 */

/** What the card's status dot shows. `abstained` = the child declined with a reason. */
export type SubAgentCardState = "running" | "done" | "failed" | "abstained";

/** The minimum a card needs. Both live and persisted sub-agents map onto it. */
export interface SubAgentCardInput<C extends StepCall & { readonly args?: unknown } = StepCall & { readonly args?: unknown }> {
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  /** How the child's run ended, when known (an abstention reads as `abstained`, not failed). */
  readonly ending?: TurnEnding;
  /** Epoch ms of its start; 0 when never seen. */
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly costUsd?: number;
  readonly calls: readonly C[];
  /** The child's latest narration (what it said it is doing). */
  readonly narration?: string;
  readonly output?: string;
  /** Why it failed or abstained, when known. */
  readonly reason?: string;
  /** Its goal status (from `goalSummaryOf` on its checklist group). */
  readonly goals?: GoalStatus;
  /** The strategy the child ran, when its run reported one. */
  readonly strategy?: string;
}

export interface SubAgentCard {
  readonly title: string;
  readonly state: SubAgentCardState;
  readonly toolCalls: number;
  /** Failed calls (any; the drill-in shows which were fixed). */
  readonly failedCalls: number;
  readonly durationMs?: number;
  /** `12s`, `1m 4s`; empty when unknown. */
  readonly durationLabel: string;
  /** `$0.004`; empty when unknown. */
  readonly costLabel: string;
  /** `3 tools · 12s · $0.004`, unknown parts omitted. */
  readonly meta: string;
  /** One line: the running call with a short hint, else the latest narration, else the result's first line. */
  readonly activity: string;
  readonly goals: GoalStatus;
  readonly strategy?: string;
}

/** Rollup header over a set of cards: `4 agents · 2 running`. */
export interface SubAgentRollup {
  readonly total: number;
  readonly running: number;
  readonly failed: number;
  readonly label: string;
}

const HINT_KEYS = ["query", "q", "url", "path", "file", "command", "prompt", "task", "name", "symbol", "id"] as const;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const firstLine = (text: string | undefined): string =>
  (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "").replace(/[*_`]/g, "").trim())
    .find((l) => l.length > 0) ?? "";

/**
 * A short human hint from tool arguments: the value of a well-known key
 * (`query`, `url`, `path`, …) or the first short string value, quoted. Never
 * JSON. Empty when nothing reads well.
 */
export function argHint(args: unknown, max = 48): string {
  let value: unknown = args;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t.startsWith("{")) return t.length > 0 ? `“${clip(t.replace(/\s+/g, " "), max)}”` : "";
    try {
      value = JSON.parse(t);
    } catch {
      return "";
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const rec = value as Readonly<Record<string, unknown>>;
  const picked =
    HINT_KEYS.map((k) => rec[k]).find((v): v is string => typeof v === "string" && v.trim().length > 0) ??
    Object.values(rec).find((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200);
  return picked === undefined ? "" : `“${clip(picked.replace(/\s+/g, " ").trim(), max)}”`;
}

/** `http-get: 429 Too Many Requests` from the last failed call, or empty. */
const lastFailure = (calls: readonly StepCall[]): string => {
  const f = [...calls].reverse().find((c) => c.status === "failed");
  return f === undefined ? "" : `${shortToolName(f.name)}: ${failureReason(f.error)}`;
};

const formatCost =(usd: number): string => `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** Build the card. `now` (epoch ms) times a child that still runs. */
export function subAgentCardOf(input: SubAgentCardInput, now: number): SubAgentCard {
  const state: SubAgentCardState =
    input.status === "running" ? "running" : input.ending === "abstained" ? "abstained" : input.status === "failed" ? "failed" : "done";
  const durationMs =
    input.startedAt > 0
      ? input.endedAt !== undefined
        ? input.endedAt - input.startedAt
        : state === "running"
          ? now - input.startedAt
          : undefined
      : undefined;
  const durationLabel = durationMs !== undefined ? formatTurnDuration(durationMs) : "";
  const costLabel = input.costUsd !== undefined ? formatCost(input.costUsd) : "";
  const toolCalls = input.calls.length;
  const running = [...input.calls].reverse().find((c) => c.status === "running");
  const last = input.calls.at(-1);
  const callLine = (c: StepCall & { readonly args?: unknown }): string => {
    const hint = argHint(c.args);
    return `${shortToolName(c.name)}${hint ? ` ${hint}` : ""}`;
  };
  const activity = clip(
    state === "running"
      ? running !== undefined
        ? callLine(running)
        : firstLine(input.narration) || (last !== undefined ? callLine(last) : "Starting…")
      : state === "failed" || state === "abstained"
        ? firstLine(input.reason) ||
          lastFailure(input.calls) ||
          firstLine(input.output) ||
          (state === "abstained" ? "Declined" : "Failed")
        : firstLine(input.output) || (last !== undefined ? callLine(last) : "Finished"),
    140,
  );
  return {
    title: input.name,
    state,
    toolCalls,
    failedCalls: input.calls.filter((c) => c.status === "failed").length,
    ...(durationMs !== undefined ? { durationMs } : {}),
    durationLabel,
    costLabel,
    meta: [`${toolCalls} ${toolCalls === 1 ? "tool" : "tools"}`, durationLabel, costLabel].filter((p) => p !== "").join(" · "),
    activity,
    goals: input.goals ?? "none",
    ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
  };
}

/** `1 agent`, `4 agents · 2 running`, `4 agents · 1 failed`. */
export function subAgentRollup(cards: readonly Pick<SubAgentCard, "state">[]): SubAgentRollup {
  const total = cards.length;
  const running = cards.filter((c) => c.state === "running").length;
  const failed = cards.filter((c) => c.state === "failed").length;
  const parts = [`${total} ${total === 1 ? "agent" : "agents"}`];
  if (running > 0) parts.push(`${running} running`);
  if (failed > 0) parts.push(`${failed} failed`);
  return { total, running, failed, label: parts.join(" · ") };
}
