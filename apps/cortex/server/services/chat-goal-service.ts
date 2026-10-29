import type { Database } from "bun:sqlite";
import type { GoalBudget, GoalCriterion, GoalCriterionCheck, GoalState, GoalStatus, GoalVerdict } from "@reactive-agents/core";
import { generateTaskId } from "@reactive-agents/core";
import { pursueGoal, type GoalCheckOutcome, type GoalEvaluation, type GoalSegmentResult } from "@reactive-agents/runtime";
import { getChatSession } from "../db/chat-queries.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import { ChatSessionBusyError, type CortexChatResult } from "./chat-session-service.js";

/**
 * Default budget for a proposed goal (design decision 4). `maxTokens` is the backstop for
 * turns that report no cost: `maxCostUsd` cannot fire on an unpriced turn, tokens still can.
 */
export const DEFAULT_GOAL_BUDGET: GoalBudget = { maxSegments: 5, maxCostUsd: 1, maxTokens: 200_000 };

/** Longest a segment waits for a busy session (e.g. a user turn in flight) before the goal is blocked. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_POLL_MS = 250;

/** A persisted goal: `GoalState` plus whether its `spent.costUsd` is a trustworthy total. */
export type ChatGoal = GoalState & {
  /** `false` once any turn or checker call reported no cost: `maxCostUsd` is then unenforced and `costUsd` a lower bound. */
  readonly costKnown: boolean;
};

const TERMINAL: ReadonlySet<GoalStatus> = new Set(["achieved", "stalled", "blocked", "budget-exhausted", "cancelled"]);

/** A goal plus the facts the UI needs to word its verdict honestly. */
export interface ChatGoalRecord {
  readonly goal: ChatGoal;
  /** `true` achieved, `false` determinately not, `null` undecided (or not evaluated yet). */
  readonly goalAchieved: boolean | null;
  /** Reason for the latest status transition, or null before any segment ran. */
  readonly reason: string | null;
}

/** Why a goal operation was refused; the router maps it to 400/404/409. */
export type GoalFailure = { readonly ok: false; readonly code: "invalid" | "not-found" | "conflict"; readonly message: string };
/** Result of a goal operation. */
export type GoalResult = ({ readonly ok: true } & ChatGoalRecord) | GoalFailure;

const fail = (code: GoalFailure["code"], message: string): GoalFailure => ({ ok: false, code, message });

/** User-supplied criterion; `id` is generated when omitted. */
export interface GoalCriterionInput {
  readonly id?: string;
  readonly text: string;
  readonly check: GoalCriterionCheck;
}

/** Input for {@link ChatGoalService.propose}. */
export interface ProposeGoalInput {
  readonly objective: string;
  readonly criteria?: readonly GoalCriterionInput[];
  readonly budget?: Partial<GoalBudget>;
}

/** Runs a chat turn; satisfied by `ChatSessionService.chat`. */
export type GoalTurnRunner = (sessionId: string, message: string) => Promise<CortexChatResult>;

/**
 * Tier-2 rubric checker for one segment. Returns `null` when it cannot decide, or a
 * {@link GoalCheckOutcome} to have its own spend counted in the goal's `spent`.
 * An outcome without `costUsd` marks the goal's cost unknown.
 */
export type GoalRubricChecker = (
  sessionId: string,
  state: GoalState,
  result: GoalSegmentResult,
) => Promise<GoalVerdict | GoalCheckOutcome | null>;

type Control = { status: "paused" | "cancelled" };

const VERDICTS: readonly GoalVerdict[] = ["achieved", "progressing", "stalled", "blocked"];

/** Parse a checker reply to one verdict word; anything else is undecided (`null`). */
export function parseVerdict(raw: string): GoalVerdict | null {
  const hits = VERDICTS.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(raw));
  return hits.length === 1 ? hits[0]! : null;
}

/** Segment prompt: objective, criteria, continue instruction. The only model-visible goal text. */
export function segmentPrompt(state: GoalState): string {
  const criteria = state.criteria.map((c) => `- ${c.text}`).join("\n");
  return [
    `Goal: ${state.objective}`,
    `Completion criteria:\n${criteria}`,
    `This is segment ${state.segments + 1} of at most ${state.budget.maxSegments}. Continue toward the goal.`,
  ].join("\n\n");
}

/**
 * Default rubric checker: a tool-less one-shot agent on the session's own
 * provider/model. Reports its own cost/tokens so they count toward the goal's `spent`.
 */
export function makeAgentRubricChecker(db: Database): GoalRubricChecker {
  return async (sessionId, state, result) => {
    const row = getChatSession(db, sessionId);
    if (!row) return null;
    const cfg = row.agentConfig;
    const agent = await buildCortexAgent({
      agentName: "goal-checker",
      provider: typeof cfg.provider === "string" ? cfg.provider : "anthropic",
      ...(typeof cfg.model === "string" && cfg.model.trim() ? { model: cfg.model.trim() } : {}),
      ...(typeof cfg.numCtx === "number" && cfg.numCtx > 0 ? { numCtx: cfg.numCtx } : {}),
      temperature: 0,
    });
    try {
      const rubric = state.criteria.filter((c) => c.check.kind === "rubric").map((c) => `- ${c.text}`).join("\n");
      const out = await agent.run(
        `You judge progress on a goal. Goal: ${state.objective}\n\nCriteria that need judgment:\n${rubric}\n\nLatest work output:\n${result.output.slice(0, 4000)}\n\nReply with exactly one word: achieved (every criterion is met by the output), progressing (real progress, not done), stalled (no useful progress), or blocked (cannot proceed).`,
      );
      const cost = out.metadata?.cost;
      const tokens = out.metadata?.tokensUsed;
      return {
        verdict: parseVerdict(String(out.output ?? "")),
        ...(typeof cost === "number" && Number.isFinite(cost) ? { costUsd: cost } : {}),
        ...(typeof tokens === "number" && Number.isFinite(tokens) ? { tokens } : {}),
        ...(typeof out.metadata?.duration === "number" ? { durationMs: out.metadata.duration } : {}),
      };
    } finally {
      await agent.dispose();
    }
  };
}

/** Mutable facts about one in-flight pursuit. */
interface Run {
  control: Control | undefined;
  done: Promise<void>;
  /** Cleared when any turn or checker call reports no cost; folded into the saved goal. */
  costKnown: boolean;
}

/**
 * Did this turn move the goal forward? Evidence signal, strongest first:
 *  1. `turn.evidence`: a checklist item newly completed, or a new successful tool result.
 *     A tool that was called but failed is not progress.
 *  2. Fallback when the turn reports no evidence (older/other paths): any tool was used.
 * Deliverable changes are not exposed on `CortexChatResult`, so they are not part of the signal.
 */
export function turnProgressed(turn: CortexChatResult): boolean {
  if (turn.evidence) return turn.evidence.toolResults > 0 || turn.evidence.checklistCompleted > 0;
  return (turn.toolsUsed?.length ?? 0) > 0;
}

/** First exhausted budget axis against already-saved spend, or undefined. */
function spentAxis(g: GoalState): string | undefined {
  const { budget: b, spent } = g;
  if (g.segments >= b.maxSegments) return "maxSegments";
  if (b.maxCostUsd !== undefined && spent.costUsd >= b.maxCostUsd) return "maxCostUsd";
  if (b.maxTokens !== undefined && spent.tokens >= b.maxTokens) return "maxTokens";
  if (b.maxWallClockMs !== undefined && spent.wallClockMs >= b.maxWallClockMs) return "maxWallClockMs";
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Row = { goal_json: string; goal_achieved: number | null; reason: string | null };

/**
 * One goal per chat session, supervised by `pursueGoal` with
 * `ChatSessionService.chat` as the segment runner. While a goal is `active` the
 * router refuses user turns (409). Active goals are paused on boot.
 */
export class ChatGoalService {
  private readonly running = new Map<string, Run>();
  private disposed = false;
  private readonly now: () => number;
  private readonly checker: GoalRubricChecker;
  private readonly idleTimeoutMs: number;
  private readonly idlePollMs: number;

  constructor(
    private readonly db: Database,
    private readonly runTurn: GoalTurnRunner,
    opts?: {
      readonly now?: () => number;
      readonly checker?: GoalRubricChecker;
      /** How long a segment waits for a busy session before the goal is blocked. Default 60s. */
      readonly idleTimeoutMs?: number;
      /** Poll interval while waiting for the session to go idle. Default 250ms. */
      readonly idlePollMs?: number;
    },
  ) {
    this.now = opts?.now ?? Date.now;
    this.checker = opts?.checker ?? makeAgentRubricChecker(db);
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idlePollMs = opts?.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
  }

  /** Restart safety: segments do not survive a process, so every active goal becomes paused. */
  recoverOnBoot(): number {
    const rows = this.db.prepare("SELECT session_id, goal_json FROM chat_goals").all() as Array<{ session_id: string; goal_json: string }>;
    let n = 0;
    for (const r of rows) {
      const goal = parseGoal(r.goal_json);
      if (goal.status !== "active") continue;
      this.save(r.session_id, { ...goal, status: "paused" }, null, "paused: server restarted while the goal was active");
      n += 1;
    }
    return n;
  }

  /** The session's goal, or null. */
  get(sessionId: string): ChatGoalRecord | null {
    const r = this.db.prepare("SELECT goal_json, goal_achieved, reason FROM chat_goals WHERE session_id = ?").get(sessionId) as Row | undefined;
    if (!r) return null;
    return {
      goal: parseGoal(r.goal_json),
      goalAchieved: r.goal_achieved === null ? null : r.goal_achieved === 1,
      reason: r.reason,
    };
  }

  /** The goal that owns the session right now (status `active`), or null. */
  activeGoal(sessionId: string): ChatGoal | null {
    const rec = this.get(sessionId);
    return rec && rec.goal.status === "active" ? rec.goal : null;
  }

  /** Resolves when no pursuit is running for the session. For tests and shutdown ordering. */
  async settled(sessionId: string): Promise<void> {
    await this.running.get(sessionId)?.done;
  }

  /** Stop supervising. In-flight segments finish; their goals are left `paused`, never `cancelled`. */
  dispose(): void {
    this.disposed = true;
    for (const r of this.running.values()) r.control = r.control ?? { status: "paused" };
  }

  /** Create a proposal. Replaces a previous proposal or finished goal; refuses while one is active or paused. */
  propose(sessionId: string, input: ProposeGoalInput): GoalResult {
    if (!getChatSession(this.db, sessionId)) return fail("not-found", `Chat session ${sessionId} not found`);
    const objective = input.objective.trim();
    if (!objective) return fail("invalid", "objective is required");
    const existing = this.get(sessionId);
    if (existing && (existing.goal.status === "active" || existing.goal.status === "paused")) {
      return fail("conflict", `session already has a ${existing.goal.status} goal: "${existing.goal.objective}"`);
    }
    const criteria: GoalCriterion[] = [];
    const seen = new Set<string>();
    for (const [i, c] of (input.criteria ?? []).entries()) {
      const text = c.text.trim();
      if (!text) return fail("invalid", "criterion text is required");
      if (c.check.kind === "regex") {
        try {
          new RegExp(c.check.pattern);
        } catch {
          return fail("invalid", `criterion "${text}" has an invalid regex`);
        }
      }
      const id = c.id?.trim() || `c${i + 1}`;
      if (seen.has(id)) return fail("invalid", `duplicate criterion id "${id}"`);
      seen.add(id);
      criteria.push({ id, text, check: c.check });
    }
    if (criteria.length === 0) criteria.push({ id: "c1", text: objective, check: { kind: "rubric" } });
    const budget: GoalBudget = { ...DEFAULT_GOAL_BUDGET, ...stripUndefined(input.budget ?? {}) };
    if (!Number.isInteger(budget.maxSegments) || budget.maxSegments < 1) return fail("invalid", "budget.maxSegments must be a positive integer");
    for (const [k, v] of [["maxCostUsd", budget.maxCostUsd], ["maxTokens", budget.maxTokens], ["maxWallClockMs", budget.maxWallClockMs]] as const) {
      if (v !== undefined && !(v > 0)) return fail("invalid", `budget.${k} must be positive`);
    }
    const goal: ChatGoal = {
      id: generateTaskId(),
      objective,
      criteria,
      budget,
      status: "proposed",
      segments: 0,
      spent: { costUsd: 0, tokens: 0, wallClockMs: 0 },
      verdictHistory: [],
      noDeltaStreak: 0,
      costKnown: true,
    };
    this.save(sessionId, goal, null, null);
    return { ok: true, goal, goalAchieved: null, reason: null };
  }

  /** `proposed` -> `active`; starts the first segment in the background. */
  accept(sessionId: string): GoalResult {
    const rec = this.get(sessionId);
    if (!rec) return fail("not-found", "no goal for this session");
    if (rec.goal.status !== "proposed") return fail("conflict", `goal is ${rec.goal.status}, not proposed`);
    return this.start(sessionId, rec);
  }

  /**
   * `paused` | `stalled` | `blocked` -> `active`; continues from the saved segment count and spend.
   * A stalled or blocked goal restarts with a fresh no-delta streak (a blocked goal whose segment
   * threw simply retries). Refused while a segment is still in flight, or when the budget is spent.
   */
  resume(sessionId: string): GoalResult {
    const rec = this.get(sessionId);
    if (!rec) return fail("not-found", "no goal for this session");
    const status = rec.goal.status;
    if (status !== "paused" && status !== "stalled" && status !== "blocked") {
      return fail("conflict", `goal is ${status}, not paused, stalled or blocked`);
    }
    if (this.running.has(sessionId)) return fail("conflict", "the last segment is still finishing; try again shortly");
    const axis = spentAxis(rec.goal);
    if (status !== "paused" && axis !== undefined) return fail("conflict", `budget already spent (${axis}); propose a new goal`);
    return this.start(sessionId, { ...rec, goal: { ...rec.goal, noDeltaStreak: 0 } }, status === "paused" ? "resumed" : `resumed from ${status}`);
  }

  /** Pause between segments. A segment already in flight finishes first (never killed mid-turn). */
  pause(sessionId: string): GoalResult {
    const rec = this.get(sessionId);
    if (!rec) return fail("not-found", "no goal for this session");
    if (rec.goal.status !== "active") return fail("conflict", `goal is ${rec.goal.status}, not active`);
    return this.control(sessionId, rec, "paused", "paused by user");
  }

  /** Cancel a proposed, active or paused goal. An in-flight segment finishes first. */
  cancel(sessionId: string): GoalResult {
    const rec = this.get(sessionId);
    if (!rec) return fail("not-found", "no goal for this session");
    if (TERMINAL.has(rec.goal.status)) return fail("conflict", `goal is already ${rec.goal.status}`);
    return this.control(sessionId, rec, "cancelled", "cancelled by user");
  }

  private control(sessionId: string, rec: ChatGoalRecord, status: Control["status"], reason: string): GoalResult {
    const run = this.running.get(sessionId);
    if (run) run.control = { status };
    const goal: ChatGoal = { ...rec.goal, status };
    this.save(sessionId, goal, rec.goalAchieved, reason);
    return { ok: true, goal, goalAchieved: rec.goalAchieved, reason };
  }

  private start(sessionId: string, rec: ChatGoalRecord, reason = "accepted"): GoalResult {
    if (this.disposed) return fail("conflict", "goal service is shut down");
    const goal: ChatGoal = { ...rec.goal, status: "active" };
    this.save(sessionId, goal, null, reason);
    const entry: Run = { control: undefined, done: Promise.resolve(), costKnown: rec.goal.costKnown };
    this.running.set(sessionId, entry);
    entry.done = pursueGoal({
      state: goal,
      isCancelled: () => entry.control !== undefined || this.disposed,
      runSegment: (state) => this.segment(sessionId, state, entry),
      check: async (state, result) => {
        const out = await this.checker(sessionId, state, result);
        if (typeof out === "object" && out !== null && out.costUsd === undefined) entry.costKnown = false;
        return out;
      },
      onUpdate: (ev) => this.onUpdate(sessionId, entry, ev),
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.running.delete(sessionId);
      });
    return { ok: true, goal, goalAchieved: null, reason };
  }

  /**
   * Run one segment as an ordinary chat turn. If the session is busy (a user turn in flight when
   * the goal was accepted), poll until idle, up to `idleTimeoutMs`; only then does the goal block.
   */
  private async segment(sessionId: string, state: GoalState, entry: Run): Promise<GoalSegmentResult> {
    const t0 = this.now();
    const deadline = t0 + this.idleTimeoutMs;
    let turn: CortexChatResult | undefined;
    while (turn === undefined) {
      try {
        turn = await this.runTurn(sessionId, segmentPrompt(state));
      } catch (e) {
        if (!(e instanceof ChatSessionBusyError)) throw e;
        if (entry.control !== undefined || this.disposed) throw e;
        if (this.now() >= deadline) {
          throw new Error(`session still busy after ${Math.round(this.idleTimeoutMs / 1000)}s waiting for the in-flight turn to finish`);
        }
        await sleep(this.idlePollMs);
      }
    }
    if (turn.cost === undefined || !Number.isFinite(turn.cost)) entry.costKnown = false;
    return {
      output: turn.reply,
      progressed: turnProgressed(turn),
      costUsd: turn.cost ?? 0,
      tokens: turn.tokensUsed,
      durationMs: this.now() - t0,
    };
  }

  private onUpdate(sessionId: string, entry: Run, ev: GoalEvaluation): void {
    // A user pause/cancel (or shutdown) wins over the supervisor's non-terminal status; spend and
    // history still accumulate so nothing a finished segment cost is lost.
    const forced = entry.control?.status ?? (this.disposed ? "paused" : undefined);
    const state: ChatGoal = { ...ev.state, costKnown: entry.costKnown, ...(forced !== undefined ? { status: forced } : {}) };
    this.save(sessionId, state, ev.goalAchieved, ev.reason);
  }

  private save(sessionId: string, goal: ChatGoal, goalAchieved: boolean | null, reason: string | null): void {
    this.db
      .prepare(
        `INSERT INTO chat_goals (session_id, goal_json, goal_achieved, reason, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET goal_json = excluded.goal_json, goal_achieved = excluded.goal_achieved,
           reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .run(sessionId, JSON.stringify(goal), goalAchieved === null ? null : goalAchieved ? 1 : 0, reason, this.now());
  }
}

/** Parse a stored goal; rows saved before `costKnown` existed are treated as known. */
function parseGoal(json: string): ChatGoal {
  const raw = JSON.parse(json) as GoalState & { costKnown?: boolean };
  return { ...raw, costKnown: raw.costKnown !== false };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
