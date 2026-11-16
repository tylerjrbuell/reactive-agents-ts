/**
 * A chat session's plan: read and edit through the framework (`AgentSession.plan` /
 * `setPlan`), persisted with the session. The conversation's to-do list stays the one store of
 * steps, statuses, tool hints and origin (`cortex_chat_sessions.todo_json`, the framework's own
 * seed row); the plan meta (id, goal, author) a list cannot carry sits beside it
 * (`db/chat-plan-queries.ts`). Cortex only renders and persists: the plan's meaning (what
 * `setPlan` seeds, `PlanRecorded`) is the framework's.
 */
import { planStepToolHint, type Plan, type PlanFinding, type PlanStep } from "@reactive-agents/core";
import { resolveStepTools, withTitleToolHints } from "./chat-plan-tools.js";
import { getChatPlanMeta, getChatTodoWithHints, setChatPlanMeta, type StoredPlanMeta } from "../db/chat-plan-queries.js";
import { getChatSession, setChatTodo, type StoredTodoItem } from "../db/chat-queries.js";
import { CortexNotFoundError } from "../errors.js";

type Db = Parameters<typeof setChatTodo>[0];

/** One step as an editor sends it. */
export interface PlanStepBody {
  readonly id?: string;
  readonly title: string;
  readonly tool?: string;
  readonly status?: PlanStep["status"];
}

/** The slice of the framework `AgentSession` plan editing needs. */
export interface PlanSessionLike {
  readonly plan: Plan | undefined;
  setPlan(input: Plan | readonly PlanStepBody[]): Plan;
  todo(): readonly StoredTodoItem[];
}

/** Most steps a plan may hold (the to-do list's own cap). */
export const PLAN_MAX_STEPS = 50;
const TITLE_MAX = 500;
const TOOL_MAX = 100;
const STATUSES: ReadonlySet<string> = new Set(["pending", "in-progress", "done", "skipped"]);

/** Trim and bound editor steps. `ok: false` carries the reason for a 400. Pure. */
export function cleanPlanSteps(
  raw: readonly PlanStepBody[],
): { readonly ok: true; readonly steps: readonly PlanStepBody[] } | { readonly ok: false; readonly error: string } {
  if (raw.length > PLAN_MAX_STEPS) return { ok: false, error: `Invalid plan: at most ${PLAN_MAX_STEPS} steps` };
  const seen = new Set<string>();
  const steps: PlanStepBody[] = [];
  for (const s of raw) {
    const title = s.title.trim();
    const tool = s.tool?.trim() ?? "";
    const id = s.id?.trim() ?? "";
    if (title === "" || title.length > TITLE_MAX) return { ok: false, error: `Invalid plan: a step title must be 1-${TITLE_MAX} characters` };
    if (tool.length > TOOL_MAX) return { ok: false, error: `Invalid plan: a tool name is at most ${TOOL_MAX} characters` };
    if (s.status !== undefined && !STATUSES.has(s.status)) return { ok: false, error: `Invalid plan: unknown step status "${s.status}"` };
    if (id !== "" && seen.has(id)) return { ok: false, error: `Invalid plan: duplicate step id "${id}"` };
    if (id !== "") seen.add(id);
    steps.push({ title, ...(id !== "" ? { id } : {}), ...(tool !== "" ? { tool } : {}), ...(s.status !== undefined ? { status: s.status } : {}) });
  }
  return { ok: true, steps };
}

const stepStatusOf = (status: StoredTodoItem["status"]): PlanStep["status"] =>
  status === "completed" ? "done" : status === "in_progress" ? "in-progress" : "pending";

/**
 * The plan a stored to-do list and its meta make. `null` for an empty list. A row's own hint wins;
 * a row from before lists carried hints falls back to the meta's. Pure.
 */
export function planOfStored(sessionId: string, todo: readonly StoredTodoItem[], meta: StoredPlanMeta | null): Plan | null {
  if (todo.length === 0) return null;
  const steps = todo.map((i): PlanStep => {
    // The row's hint, an older meta's, else the one the title names (rows saved before hints were derived).
    const tool = i.tool ?? meta?.tools[i.id] ?? planStepToolHint(i.title);
    return { id: i.id, title: i.title, status: stepStatusOf(i.status), ...(tool !== undefined ? { tool } : {}) };
  });
  const author = meta?.source ?? "model";
  // The rows say who wrote them (the framework's rule): a model plan whose rows the harness derived is harness-derived.
  const source = author === "model" && todo.some((i) => i.origin === "harness-derived") ? "harness-derived" : author;
  const findings = meta?.findings ?? [];
  return { id: meta?.id ?? `plan-${sessionId}`, goal: meta?.goal ?? "", steps, createdAt: meta?.createdAt ?? 0, source, ...(findings.length > 0 ? { findings } : {}) };
}

/** The to-do list a (re)built session seeds from: the stored rows with their tool hints, older rows migrated. */
export const seedTodoOf = (db: Db, sessionId: string): StoredTodoItem[] => getChatTodoWithHints(db, sessionId);

/** What a (re)built session seeds its plan from: the stored to-do list and recon findings, each only when non-empty. Spread into `agent.session(...)`. */
export function planSeedOf(db: Db, sessionId: string): { initialTodo?: StoredTodoItem[]; initialPlanFindings?: readonly PlanFinding[] } {
  const initialTodo = seedTodoOf(db, sessionId);
  const initialPlanFindings = getChatPlanMeta(db, sessionId)?.findings ?? [];
  return { ...(initialTodo.length > 0 ? { initialTodo } : {}), ...(initialPlanFindings.length > 0 ? { initialPlanFindings } : {}) };
}

/** Persist the session's list (hints and origin ride its rows) and plan meta (after a turn and after an edit). */
export function persistSessionPlan(db: Db, sessionId: string, session: Pick<PlanSessionLike, "plan" | "todo">): void {
  setChatTodo(db, sessionId, session.todo());
  const plan = session.plan;
  if (plan === undefined) return setChatPlanMeta(db, sessionId, null);
  setChatPlanMeta(db, sessionId, { id: plan.id, goal: plan.goal, source: plan.source, createdAt: plan.createdAt, ...(plan.findings && plan.findings.length > 0 ? { findings: plan.findings } : {}) });
}

/**
 * The plan an edit with a goal hands `setPlan`: the session's own plan id (an imported plan's id
 * never replaces it, so step events keep one plan), the given goal and steps. Pure.
 */
export function withGoal(current: Plan | undefined, sessionId: string, steps: readonly PlanStepBody[], goal: string, findings?: readonly PlanFinding[]): Plan {
  return {
    // An explicit empty list clears the held findings (the framework keeps the held ones when the field is absent).
    ...(findings !== undefined ? { findings } : {}),
    id: current?.id ?? `plan-${sessionId}`,
    goal,
    steps: steps.map((s, i): PlanStep => ({ id: s.id ?? `step-${i + 1}`, title: s.title, status: s.status ?? "pending", ...(s.tool !== undefined ? { tool: s.tool } : {}) })),
    createdAt: current?.createdAt ?? 0,
    source: "user-edited",
  };
}

/** What {@link ChatSessionPlans} needs from the chat service. */
export interface ChatPlanDeps {
  /** Live (cached) sessions. */
  readonly live: ReadonlyMap<string, { readonly session: PlanSessionLike }>;
  /** The session's live agent session from its stored config, built when not cached. */
  readonly build: (sessionId: string, agentConfig: Record<string, unknown>, stableAgentId: string | undefined) => Promise<{ readonly session: PlanSessionLike }>;
  /** The turn guard: throws when a turn is in flight; call the result to release. */
  readonly acquireTurn: (sessionId: string) => () => void;
}

/** Read and edit a chat session's plan. */
export class ChatSessionPlans {
  constructor(private readonly db: Db, private readonly deps: ChatPlanDeps) {}

  /** The session's plan: the live session's, else the stored list. `null` while there is none. */
  read(sessionId: string): Plan | null {
    const live = this.deps.live.get(sessionId)?.session.plan;
    if (live === undefined) return planOfStored(sessionId, getChatTodoWithHints(this.db, sessionId), getChatPlanMeta(this.db, sessionId));
    return withTitleToolHints(live); // a rebuilt session is seeded with the stored findings (`planSeedOf`)
  }

  /**
   * Replace the plan (a user edit) through `session.setPlan`: the next turn, in any mode, seeds
   * from it, and the framework publishes `PlanRecorded`. Runs under the turn guard. With a `goal`
   * (an imported plan) the plan's goal is replaced too; without one the session's goal stays.
   */
  async write(sessionId: string, steps: readonly PlanStepBody[], goal?: string, findings?: readonly PlanFinding[]): Promise<Plan> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new CortexNotFoundError({ id: sessionId, resource: "chat session" });
    const { session } = await this.deps.build(sessionId, row.agentConfig, row.stableAgentId);
    const release = this.deps.acquireTurn(sessionId);
    try {
      // Each step's tool resolves through the framework's checklist `tool` op (explicit wins, a cleared one falls back to its title's hint).
      const resolved = resolveStepTools(steps);
      // Findings: an edit's own list wins (an empty one clears); absent, the session's seeded ones are kept by the framework.
      const fullPlan = resolved.length > 0 && (goal !== undefined || findings !== undefined);
      const plan = session.setPlan(
        fullPlan ? withGoal(session.plan, sessionId, resolved, goal ?? session.plan?.goal ?? getChatPlanMeta(this.db, sessionId)?.goal ?? "", findings) : resolved,
      );
      persistSessionPlan(this.db, sessionId, session);
      return plan;
    } finally {
      release();
    }
  }
}
