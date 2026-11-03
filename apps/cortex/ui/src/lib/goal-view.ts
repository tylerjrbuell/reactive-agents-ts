/**
 * Pure view logic for chat goals, loops and schedules: command-argument parsing and the
 * display model behind `ChatGoalBar`. No I/O. Types mirror `GoalState` from
 * `@reactive-agents/core` (the UI does not depend on core) and the server's schedule shape.
 */

export type GoalStatus = "proposed" | "active" | "paused" | "achieved" | "stalled" | "blocked" | "budget-exhausted" | "cancelled";
export type GoalVerdict = "achieved" | "progressing" | "stalled" | "blocked";

export interface GoalCriterionWire {
  readonly id: string;
  readonly text: string;
  readonly check: { readonly kind: "regex" | "must-include" | "rubric" };
}

export interface GoalWire {
  readonly id: string;
  readonly objective: string;
  readonly criteria: readonly GoalCriterionWire[];
  readonly budget: { readonly maxSegments: number; readonly maxCostUsd?: number; readonly maxTokens?: number; readonly maxWallClockMs?: number };
  readonly status: GoalStatus;
  readonly segments: number;
  readonly spent: { readonly costUsd: number; readonly tokens: number; readonly wallClockMs: number };
  readonly verdictHistory: readonly (GoalVerdict | null)[];
  /** `false` when a turn reported no cost: the cost meter is unenforced and must not read as $0. */
  readonly costKnown?: boolean;
}

export interface ScheduleWire {
  readonly id: string;
  readonly kind: "loop" | "cron";
  readonly spec: string;
  readonly prompt: string;
  readonly expiresAt: number;
  readonly runs: number;
  readonly lastStatus: string | null;
}

// ── Command argument parsing ────────────────────────────────────────────────

export type GoalCommand =
  | { readonly kind: "propose"; readonly objective: string }
  | { readonly kind: "accept" | "pause" | "resume" | "cancel" | "status" }
  | { readonly kind: "usage" };

/** `/goal pause` is a control word only when it is the whole argument; anything else is an objective. */
export function parseGoalArg(arg: string): GoalCommand {
  const a = arg.trim();
  if (a === "") return { kind: "usage" };
  const word = a.toLowerCase();
  if (word === "accept" || word === "pause" || word === "resume" || word === "cancel" || word === "status") return { kind: word };
  return { kind: "propose", objective: a };
}

export type LoopCommand =
  | { readonly kind: "start"; readonly spec: string; readonly prompt: string }
  | { readonly kind: "stop" }
  | { readonly kind: "usage" };

/** `/loop 5m <prompt>` | `/loop stop`. Interval is `<n>m|h|d`; the server enforces the minimum. */
export function parseLoopArg(arg: string): LoopCommand {
  const a = arg.trim();
  if (a.toLowerCase() === "stop") return { kind: "stop" };
  const m = /^(\d+)([mhd])\s+([\s\S]+)$/i.exec(a);
  if (!m) return { kind: "usage" };
  return { kind: "start", spec: `${m[1]}${m[2]!.toLowerCase()}`, prompt: m[3]!.trim() };
}

export type ScheduleCommand =
  | { readonly kind: "create"; readonly cron: string; readonly prompt: string }
  | { readonly kind: "list" }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "usage" };

/** `/schedule "<cron>" <prompt>` | `/schedule list` | `/schedule rm <id>`. Cron must have 5 fields. */
export function parseScheduleArg(arg: string): ScheduleCommand {
  const a = arg.trim();
  if (a.toLowerCase() === "list") return { kind: "list" };
  const rm = /^(?:rm|remove)\s+(\S+)$/i.exec(a);
  if (rm) return { kind: "remove", id: rm[1]! };
  const q = /^(["'])([^"']+)\1\s+([\s\S]+)$/.exec(a);
  if (!q) return { kind: "usage" };
  const cron = q[2]!.trim().split(/\s+/);
  if (cron.length !== 5) return { kind: "usage" };
  return { kind: "create", cron: cron.join(" "), prompt: q[3]!.trim() };
}

// ── Goal display model ──────────────────────────────────────────────────────

/** Statuses during which the goal can still change on its own, so the bar polls. */
export const shouldPoll = (status: GoalStatus | undefined): boolean => status === "proposed" || status === "active";

export type GoalAction = "accept" | "pause" | "resume" | "cancel";

export interface GoalMeter {
  readonly label: string;
  readonly text: string;
  /** 0-100, or null when there is no cap to measure against. */
  readonly pct: number | null;
}

export interface GoalView {
  readonly statusLabel: string;
  readonly tone: "neutral" | "live" | "good" | "warn" | "bad";
  /** Honest verdict line: "not yet decided" for a null verdict, never "achieved" unless the goal is. */
  readonly verdictText: string;
  readonly criteria: readonly { readonly id: string; readonly text: string; readonly state: "met" | "undecided"; readonly stateText: string }[];
  readonly meters: readonly GoalMeter[];
  readonly actions: readonly GoalAction[];
  readonly terminal: boolean;
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  proposed: "Proposed: waiting for your accept",
  active: "Active",
  paused: "Paused",
  achieved: "Achieved",
  stalled: "Stalled: no progress detected",
  blocked: "Blocked",
  "budget-exhausted": "Budget exhausted",
  cancelled: "Cancelled",
};

const TONE: Record<GoalStatus, GoalView["tone"]> = {
  proposed: "neutral", active: "live", paused: "neutral", achieved: "good",
  stalled: "warn", blocked: "warn", "budget-exhausted": "bad", cancelled: "neutral",
};

const ACTIONS: Record<GoalStatus, readonly GoalAction[]> = {
  proposed: ["accept", "cancel"],
  active: ["pause", "cancel"],
  paused: ["resume", "cancel"],
  achieved: [], stalled: ["resume", "cancel"], blocked: ["resume", "cancel"], "budget-exhausted": [], cancelled: [],
};

/** Statuses with nothing left to do; the bar offers Dismiss only for these (stalled/blocked can resume). */
const TERMINAL: ReadonlySet<GoalStatus> = new Set(["achieved", "budget-exhausted", "cancelled"]);

const pct = (used: number, max: number): number => (max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0);

export const formatUsd = (n: number): string => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

/** Verdict line for the latest segment. Only the goal's own status may say "achieved". */
export function verdictText(goal: GoalWire): string {
  if (goal.status === "achieved") return "Achieved";
  if (goal.verdictHistory.length === 0) return "No segment checked yet";
  const last = goal.verdictHistory[goal.verdictHistory.length - 1];
  if (last === null || last === undefined) return "Last check: not yet decided";
  // The checker may say "achieved" before the supervisor confirms; report it as a claim, not the outcome.
  if (last === "achieved") return "Last check: looks complete, awaiting confirmation";
  return `Last check: ${last}`;
}

export function goalView(goal: GoalWire): GoalView {
  const meters: GoalMeter[] = [
    { label: "Segments", text: `${goal.segments}/${goal.budget.maxSegments}`, pct: pct(goal.segments, goal.budget.maxSegments) },
    goal.costKnown === false
      ? { label: "Cost", text: "cost unknown", pct: null }
      : goal.budget.maxCostUsd !== undefined
      ? { label: "Cost", text: `${formatUsd(goal.spent.costUsd)}/${formatUsd(goal.budget.maxCostUsd)}`, pct: pct(goal.spent.costUsd, goal.budget.maxCostUsd) }
      : { label: "Cost", text: formatUsd(goal.spent.costUsd), pct: null },
  ];
  if (goal.budget.maxTokens !== undefined) {
    meters.push({ label: "Tokens", text: `${goal.spent.tokens}/${goal.budget.maxTokens}`, pct: pct(goal.spent.tokens, goal.budget.maxTokens) });
  }
  const met = goal.status === "achieved";
  return {
    statusLabel: STATUS_LABEL[goal.status],
    tone: TONE[goal.status],
    verdictText: verdictText(goal),
    criteria: goal.criteria.map((c) => ({
      id: c.id,
      text: c.text,
      state: met ? "met" : "undecided",
      stateText: met ? "met" : "not yet decided",
    })),
    meters,
    actions: ACTIONS[goal.status],
    terminal: TERMINAL.has(goal.status),
  };
}

/** Human summary of a schedule for chips and `/schedule list`. */
export function scheduleLabel(s: ScheduleWire): string {
  const when = s.kind === "loop" ? `every ${s.spec}` : s.spec;
  const prompt = s.prompt.length > 32 ? `${s.prompt.slice(0, 31)}…` : s.prompt;
  return `${when}: ${prompt}`;
}

/**
 * True when a schedule that was already known has fired since `prev` (its `runs` counter rose).
 * New or removed schedules never count: a freshly (re)loaded list is not a fire, so clearing and
 * reloading the list cannot trigger a conversation refresh.
 */
export function scheduleFired(prev: ReadonlyMap<string, number>, next: readonly Pick<ScheduleWire, "id" | "runs">[]): boolean {
  return next.some((s) => {
    const before = prev.get(s.id);
    return before !== undefined && s.runs > before;
  });
}
