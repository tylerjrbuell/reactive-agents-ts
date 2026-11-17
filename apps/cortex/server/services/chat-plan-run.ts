/**
 * Run a chat session's plan in a framework strategy: `agent.execute(plan, { strategy? })`
 * (runtime a3753ac6c). The framework owns everything that matters here: it validates the plan
 * (`PlanInvalidError`), routes it by richness when no strategy is named (steps with `dependsOn` or
 * `args` run as a blueprint DAG, otherwise a plain checklist) and returns the plan with each
 * step's final status (`result.plan`). Cortex only calls it, lands the result as the session's
 * next exchange and writes the statuses back onto the stored to-do rows (the one store of steps).
 *
 * Same shape as `chat-resume.ts`: an injected host, no hidden globals.
 */
import type { Plan } from "@reactive-agents/core";
import type { AgentResult, PlanExecuteOptions, ReactiveAgent } from "@reactive-agents/runtime";
import { replyOf } from "./chat-approvals.js";
import { turnOutcomeOf, withTurnOutcome, type StoredTurnTrace } from "./chat-turn-trace.js";
import { errorText } from "./loop-stop-resume.js";
import type { StoredTodoItem } from "../db/chat-queries.js";

/** The agent surface a plan run needs. */
export type PlanRunnableAgent = Pick<ReactiveAgent, "execute">;

/** The executors a caller may name (absent: the framework chooses by the plan). */
export type PlanRunStrategy = PlanExecuteOptions["strategy"];

/** What a plan run needs from the chat session service (injected). */
export interface ChatPlanRunHost {
  /** Take the session's turn guard; throws `ChatSessionBusyError` when a turn is in flight. */
  acquireTurn(sessionId: string): () => void;
  /** The session's agent: the cached one, or rebuilt from the stored config. */
  agentFor(sessionId: string): Promise<PlanRunnableAgent>;
  /** The session's saved plan with its step extras; `null` while there is none. */
  planOf(sessionId: string): Plan | null;
  /** The conversation so far, for the run's context. */
  historyOf(sessionId: string): NonNullable<PlanExecuteOptions["history"]>;
  /** Persist one exchange (user message + reply) with the run's result and turn trace. */
  persistExchange(sessionId: string, userMessage: string, reply: string, result: AgentResult, toolsUsed: readonly string[], trace: StoredTurnTrace | undefined): void;
  /** Write the run's step statuses onto the stored to-do rows. */
  recordStatuses(sessionId: string, plan: Plan): void;
  /** Drop the cached agent so the next turn rebuilds history and the to-do list from the DB. */
  evict(sessionId: string): Promise<void>;
}

/** Why a plan run was refused or failed. */
export type ChatPlanRunFailure =
  | { readonly code: "busy" | "no-plan" | "failed"; readonly message: string }
  | { readonly code: "invalid-plan"; readonly message: string; /** The framework's `PlanInvalidError.reason`. */ readonly reason: string };

/** Outcome of {@link ChatPlanRun.run}. */
export type ChatPlanRunOutcome =
  | { readonly ok: true; readonly reply: string; readonly success: boolean; readonly plan: Plan | null }
  | ({ readonly ok: false } & ChatPlanRunFailure);

/** The framework's `PlanInvalidError.reason` when `e` is one (tag dispatch, as the other rails do); `undefined` otherwise. */
export function planInvalidReason(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null || Reflect.get(e, "_tag") !== "PlanInvalidError") return undefined;
  const reason: unknown = Reflect.get(e, "reason");
  return typeof reason === "string" ? reason : undefined;
}

/** The user message a plan run lands in the thread. */
export const planRunMessage = (strategy: PlanRunStrategy): string => (strategy === undefined ? "Execute the plan." : `Execute the plan with ${strategy}.`);

/**
 * The stored rows with the statuses a run ended with. A row the plan no longer names keeps its
 * own; `skipped` closes a row like `done` does (the list has no `skipped`). Pure.
 */
export function todoWithStatuses(todo: readonly StoredTodoItem[], plan: Plan): StoredTodoItem[] {
  const byId = new Map(plan.steps.map((s) => [s.id, s.status] as const));
  return todo.map((row) => {
    const status = byId.get(row.id);
    if (status === undefined) return row;
    return { ...row, status: status === "done" || status === "skipped" ? "completed" : status === "in-progress" ? "in_progress" : "pending" };
  });
}

export class ChatPlanRun {
  constructor(private readonly host: ChatPlanRunHost) {}

  /**
   * Run the session's plan. Under the session's turn guard (a turn in flight is busy). The result
   * lands as the session's next exchange whatever its outcome. A plan the framework refuses
   * (`PlanInvalidError`) is `invalid-plan` with the framework's reason, and nothing is stored.
   */
  async run(sessionId: string, strategy: PlanRunStrategy): Promise<ChatPlanRunOutcome> {
    const plan = this.host.planOf(sessionId);
    if (plan === null) return { ok: false, code: "no-plan", message: "This session has no plan to run yet." };
    let release: () => void;
    try {
      release = this.host.acquireTurn(sessionId);
    } catch (e) {
      return { ok: false, code: "busy", message: errorText(e) };
    }
    try {
      let result: Awaited<ReturnType<PlanRunnableAgent["execute"]>>;
      try {
        const agent = await this.host.agentFor(sessionId);
        result = await agent.execute(plan, { ...(strategy !== undefined ? { strategy } : {}), history: this.host.historyOf(sessionId) });
      } catch (e) {
        const reason = planInvalidReason(e);
        if (reason !== undefined) return { ok: false, code: "invalid-plan", message: errorText(e), reason };
        return { ok: false, code: "failed", message: errorText(e) };
      }
      const outcome = result.success ? undefined : turnOutcomeOf(result);
      this.host.recordStatuses(sessionId, result.plan);
      this.host.persistExchange(sessionId, planRunMessage(strategy), replyOf(result), result, [], withTurnOutcome(undefined, outcome));
      await this.host.evict(sessionId);
      return { ok: true, reply: replyOf(result), success: result.success, plan: result.plan };
    } finally {
      release();
    }
  }
}
