/**
 * Chat Continue: a chat turn whose run a loop guard stopped can be continued.
 *
 * Chat agents are built with durable runs, so a tool turn checkpoints. When a
 * loop guard ends it, the framework leaves the run resumable in the durable
 * store (`RunRecord.loopStop`, `resumable`). This module:
 *   - lists a session's resumable runs by reading the store directly through the
 *     framework reader (`listDurableRuns`), without building the session's agent
 *     (a streamed turn has no run stamp, so the store is the one source for both
 *     the streamed and the non-stream path),
 *   - continues one with `agent.resumeRun(runId, { note?, extraIterations? })` on
 *     the session's agent, and lands the result as the follow-up exchange of the
 *     same session ("Continue" and the reply). It owns no resume logic: the
 *     framework resets the loop guards, adds the corrective guidance and keeps the
 *     tools already done from re-running.
 *
 * Same shape as `chat-approvals.ts`: an injected host, no hidden globals.
 */
import { existsSync } from "node:fs";
import { Effect } from "effect";
import { listDurableRuns } from "@reactive-agents/runtime";
import type { AgentResult, ReactiveAgent } from "@reactive-agents/runtime";
import { durableRunsDbPath } from "./crashed-runs.js";
import { replyOf } from "./chat-approvals.js";
import { turnOutcomeOf, withTurnOutcome, type StoredTurnTrace } from "./chat-turn-trace.js";
import {
  continueMessage,
  errorText,
  ResumeGuard,
  resumableRunsOf,
  resumeFailureOf,
  type ParsedResumeInput,
  type ResumableRunWire,
  type ResumeFailure,
} from "./loop-stop-resume.js";

/** The agent surface a Continue needs. */
export type ResumableAgent = Pick<ReactiveAgent, "resumeRun">;

/** Where a session's durable store lives. */
export interface ChatDurableSource {
  /** The id the session's agent reports under (its stable id). */
  readonly agentId: string;
  /** `durableRuns.dir` of the session config, when set. */
  readonly dir?: string;
}

/**
 * Where a stored chat session's durable store lives (the builder's Durable runs setting,
 * `durableRuns.dir`, else the framework default under the agent id), for reading it without
 * building the agent. `undefined` for an unknown session or one with no stable agent id.
 */
export function chatDurableSource(
  row: { readonly stableAgentId?: string | undefined; readonly agentConfig: Readonly<Record<string, unknown>> } | undefined | null,
): ChatDurableSource | undefined {
  if (!row?.stableAgentId) return undefined;
  const dr: unknown = row.agentConfig.durableRuns;
  const dir: unknown = dr !== null && typeof dr === "object" ? Reflect.get(dr, "dir") : undefined;
  return { agentId: row.stableAgentId, ...(typeof dir === "string" && dir.trim() !== "" ? { dir: dir.trim() } : {}) };
}

/** What chat Continue needs from the chat session service (injected). */
export interface ChatResumeHost {
  /** The session's durable store, or `undefined` for an unknown session or one without a stable agent id. */
  durableSourceOf(sessionId: string): ChatDurableSource | undefined;
  /** Take the session's turn guard; throws `ChatSessionBusyError` when a turn is in flight. */
  acquireTurn(sessionId: string): () => void;
  /** The session's agent: the cached one, or rebuilt from the stored config. */
  agentFor(sessionId: string): Promise<ResumableAgent>;
  /** Persist one exchange (user message + reply) with the run's result and turn trace. */
  persistExchange(
    sessionId: string,
    userMessage: string,
    reply: string,
    result: AgentResult,
    toolsUsed: readonly string[],
    trace: StoredTurnTrace | undefined,
  ): void;
  /** Drop the cached agent so the next turn rebuilds history from the DB. */
  evict(sessionId: string): Promise<void>;
}

/** Outcome of {@link ChatResume.resume}. */
export type ChatResumeOutcome =
  | {
      readonly ok: true;
      readonly reply: string;
      readonly success: boolean;
      /** The continued run stopped on a loop guard again: Continue is offered once more. */
      readonly resumable: boolean;
    }
  | ({ readonly ok: false } & ResumeFailure);

export class ChatResume {
  constructor(
    private readonly host: ChatResumeHost,
    private readonly guard: ResumeGuard = new ResumeGuard(),
  ) {}

  /**
   * Resumable loop-stopped runs of a session, newest first. Reads the durable
   * store without opening it when the file does not exist, so looking never
   * creates a store or builds an agent.
   */
  async list(sessionId: string): Promise<ResumableRunWire[]> {
    const source = this.host.durableSourceOf(sessionId);
    if (!source) return [];
    const dbPath = durableRunsDbPath(source.agentId, source.dir);
    if (!existsSync(dbPath)) return [];
    const records = await Effect.runPromise(listDurableRuns({ dbPath }));
    return resumableRunsOf(records.filter((r) => r.agentId === source.agentId));
  }

  /**
   * Continue a loop-stopped run of the session. Guarded per run (a second tap
   * while the first runs is refused) and per session (a turn in flight is busy).
   * The result lands as the session's next exchange, whatever its outcome: a run
   * that stops on a loop guard again is stored as a failed turn and stays
   * resumable.
   */
  async resume(sessionId: string, runId: string, input: Extract<ParsedResumeInput, { ok: true }>): Promise<ChatResumeOutcome> {
    const slot = this.guard.claim(runId);
    if (!slot) return { ok: false, code: "busy", message: "This run is already being continued." };
    try {
      const listed = await this.list(sessionId);
      if (!listed.some((r) => r.runId === runId)) {
        return {
          ok: false,
          code: "not-resumable",
          message: "That run is not stopped on a loop guard in this chat, so it cannot be continued. Send a new message instead.",
        };
      }
      let release: () => void;
      try {
        release = this.host.acquireTurn(sessionId);
      } catch (e) {
        return { ok: false, code: "busy", message: errorText(e) };
      }
      try {
        let result: AgentResult;
        try {
          const agent = await this.host.agentFor(sessionId);
          result = await agent.resumeRun(runId, input.options);
        } catch (e) {
          return { ok: false, ...resumeFailureOf(e) };
        }
        const reply = replyOf(result);
        const outcome = result.success ? undefined : turnOutcomeOf(result);
        this.host.persistExchange(sessionId, continueMessage(input.options.note), reply, result, [], withTurnOutcome(undefined, outcome));
        // The cached engine did not see this exchange: rebuild its history from the DB.
        await this.host.evict(sessionId);
        return { ok: true, reply, success: result.success, resumable: result.resumable === true };
      } finally {
        release();
      }
    } finally {
      slot();
    }
  }
}
