/**
 * `/btw <question>`: a side question about a chat's current run. It is answered by a
 * separate, tool-less, one-shot call on the chat's own provider and model, from a
 * snapshot of the run's context (the task, the steps so far, the answer draft). It never
 * enters the chat's history, the running turn's messages, or the cached session agent, so
 * it cannot change the run. With no run in progress the snapshot is the last turn.
 */
import type { Database } from "bun:sqlite";
import { buildCortexAgent } from "./build-cortex-agent.js";
import { getChatSession, getChatTurns, type ChatTurnRow } from "../db/chat-queries.js";
import { UTILITY_AGENT_PARAMS, UTILITY_MEMORY_OFF, utilityOutput, utilityPrompt } from "./utility-agent.js";

/** One tool call of the run so far. */
export interface BtwStep {
  readonly tool: string;
  readonly args?: string;
  readonly result?: string;
  readonly failed?: boolean;
}

/** What the side question is answered from. */
export interface BtwContext {
  /** The user message the run is working on. */
  readonly task: string;
  readonly steps: readonly BtwStep[];
  /** The answer text streamed so far (running), or the final answer (settled). */
  readonly draft: string;
  readonly running: boolean;
}

const LIMITS = { question: 2000, task: 2000, steps: 12, args: 300, result: 600, draft: 4000 } as const;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The prompt: context first (quoted material), the instruction after the marker. Bounded, so a long run cannot overflow the window. */
export function btwPrompt(question: string, ctx: BtwContext): string {
  const steps = ctx.steps.slice(-LIMITS.steps).map((s, i) => {
    const bits = [`${i + 1}. ${s.tool}${s.failed ? " (failed)" : ""}`];
    if (s.args) bits.push(`   args: ${clip(s.args, LIMITS.args)}`);
    if (s.result) bits.push(`   result: ${clip(s.result, LIMITS.result)}`);
    return bits.join("\n");
  });
  const quoted = [
    `The agent's run is ${ctx.running ? "still in progress" : "finished"}.`,
    `Task:\n${clip(ctx.task, LIMITS.task)}`,
    `Steps so far (${ctx.steps.length}${ctx.steps.length > LIMITS.steps ? `, last ${LIMITS.steps} shown` : ""}):\n${steps.length > 0 ? steps.join("\n") : "none yet"}`,
    `${ctx.running ? "Answer draft so far" : "Final answer"}:\n${ctx.draft.trim() === "" ? "nothing yet" : clip(ctx.draft, LIMITS.draft)}`,
  ].join("\n\n");
  return utilityPrompt(
    quoted,
    `You are not the agent doing the task above. You are an observer answering one side question from the user about the agent's run, asked without interrupting it.\n\n` +
      `Side question: ${clip(question, LIMITS.question)}\n\n` +
      "Answer only that question, in one to three sentences, using only the run context above. If the context does not say, reply that it is not known yet. Do not do, redo, continue or rewrite the task, and do not repeat the answer draft. You cannot run tools.",
  );
}

/** The last exchange of a stored chat as a settled context (used when the client sends none). */
export function btwContextFromTurns(turns: readonly ChatTurnRow[]): BtwContext {
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  const before = lastAssistant ? turns.filter((t) => t.id < lastAssistant.id) : turns;
  const lastUser = [...before].reverse().find((t) => t.role === "user") ?? [...turns].reverse().find((t) => t.role === "user");
  return {
    task: lastUser?.content ?? "",
    steps: (lastAssistant?.toolsUsed ?? []).map((tool) => ({ tool })),
    draft: lastAssistant?.content ?? "",
    running: false,
  };
}

/** Asks the model: injectable so tests need no live provider. */
export type BtwAsk = (cfg: Record<string, unknown>, prompt: string) => Promise<string>;

/**
 * A side question reads nothing from memory and writes nothing to it: Cortex turns memory
 * on by default, and an observer's question must not become an episodic entry or recall
 * facts into the observer's own prompt. An explicit all-off `memory` builds no memory layer.
 */
export const BTW_MEMORY_OFF = UTILITY_MEMORY_OFF;

/** Default: a tool-less one-shot agent on the session's own provider and model (same build as the goal checker). */
export const askWithAgent: BtwAsk = async (cfg, prompt) => {
  const agent = await buildCortexAgent({
    agentName: "chat-btw",
    ...UTILITY_AGENT_PARAMS,
    memory: BTW_MEMORY_OFF,
    provider: typeof cfg.provider === "string" ? cfg.provider : "anthropic",
    ...(typeof cfg.model === "string" && cfg.model.trim() ? { model: cfg.model.trim() } : {}),
    ...(typeof cfg.numCtx === "number" && cfg.numCtx > 0 ? { numCtx: cfg.numCtx } : {}),
    temperature: 0.2,
  });
  try {
    return utilityOutput(await agent.run(prompt, { origin: "cortex-utility" })).trim();
  } finally {
    await agent.dispose();
  }
};

/** A failed `/btw`: the HTTP status and a message for the user. */
export type BtwFailure = { readonly ok: false; readonly status: 400 | 404 | 502; readonly error: string };

/** Answers `/btw` questions. Holds no per-session state. */
export class ChatBtwService {
  constructor(
    private readonly db: Database,
    private readonly ask: BtwAsk = askWithAgent,
  ) {}

  async answer(sessionId: string, question: string, context?: BtwContext): Promise<{ readonly ok: true; readonly answer: string; readonly running: boolean } | BtwFailure> {
    const q = question.trim();
    if (q === "") return { ok: false, status: 400, error: "Ask a question after /btw" };
    const row = getChatSession(this.db, sessionId);
    if (!row) return { ok: false, status: 404, error: `Chat session ${sessionId} not found` };
    const ctx = context ?? btwContextFromTurns(getChatTurns(this.db, sessionId));
    if (ctx.task.trim() === "" && ctx.draft.trim() === "" && ctx.steps.length === 0) {
      return { ok: false, status: 400, error: "There is nothing to ask about yet: send a message first" };
    }
    try {
      const answer = (await this.ask(row.agentConfig, btwPrompt(q, ctx))).trim();
      if (answer === "") return { ok: false, status: 502, error: "The model gave no answer to the side question" };
      return { ok: true, answer, running: ctx.running };
    } catch (e) {
      return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
