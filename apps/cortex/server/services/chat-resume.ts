/**
 * Chat Continue: a chat turn whose run was interrupted (stopped or paused by the
 * user, a loop guard, a spent budget, a timeout, an error) can be continued.
 *
 * Chat agents are built with durable runs, so a tool turn checkpoints. When a run
 * ends without completing, the framework leaves it resumable in the durable
 * store (`RunRecord.resumable`, `stop`). This module:
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
import type { AgentResult, AgentStreamEvent, ReactiveAgent, ResumeRunOptions } from "@reactive-agents/runtime";
import { resumeEventStream } from "./chat-resume-stream.js";
import { durableRunsDbPath } from "./crashed-runs.js";
import { ChatRunControl } from "./chat-run-control.js";
import type { InterruptableAgent } from "./run-interrupt.js";
import { replyOf } from "./chat-approvals.js";
import { TurnTraceRecorder, turnOutcomeOf, withContinuedFrom, withTurnOutcome, type StoredTurnTrace } from "./chat-turn-trace.js";
import type { ChatStreamEvent } from "./chat-detached-turn.js";
import type { StrategyStepLog } from "./strategy-steps.js";
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

/** The agent surface Continue (`resumeRun`) and Pause / Stop (`pauseRun`, `stopRun`, `activeRunIds`) need. */
export type ResumableAgent = Pick<ReactiveAgent, "resumeRun"> & Partial<Pick<ReactiveAgent, "subscribe">> & InterruptableAgent;

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
  /** The session's cached agent only (never built): what is running now, for Pause / Stop and for leaving live runs out of the list. */
  liveAgentOf(sessionId: string): InterruptableAgent | undefined;
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
  /** The session's strategy-step log (its cached agent's), so a continued run's strategy card is streamed and stored like a normal turn's. */
  strategyStepsOf?(sessionId: string): StrategyStepLog | undefined;
}

/**
 * Continue is a new run linked to its parent (`newRun`): its own id and trace file, the parent's
 * record untouched, `continuedFrom` on the result. The person's note and step grant ride along.
 */
export const continueOptions = (options: ResumeRunOptions): ResumeRunOptions => ({ ...options, newRun: true });

/** Outcome of {@link ChatResume.resume}. */
export type ChatResumeOutcome =
  | {
      readonly ok: true;
      readonly reply: string;
      readonly success: boolean;
      /** The continued run was interrupted again: Continue is offered once more. */
      readonly resumable: boolean;
    }
  | ({ readonly ok: false } & ResumeFailure);

export class ChatResume {
  /** Pause / Stop of the session's running durable turn (`chat-run-control.ts`). */
  readonly control: ChatRunControl;

  constructor(
    private readonly host: ChatResumeHost,
    private readonly guard: ResumeGuard = new ResumeGuard(),
  ) {
    this.control = new ChatRunControl(host);
  }

  /**
   * Resumable runs of a session (any kind of interruption), newest first, leaving out
   * the runs live in the session's agent now. Reads the durable store without opening
   * it when the file does not exist, so looking never creates a store or builds an agent.
   */
  async list(sessionId: string): Promise<ResumableRunWire[]> {
    const source = this.host.durableSourceOf(sessionId);
    if (!source) return [];
    const dbPath = durableRunsDbPath(source.agentId, source.dir);
    if (!existsSync(dbPath)) return [];
    const records = await Effect.runPromise(listDurableRuns({ dbPath }));
    return resumableRunsOf(records.filter((r) => r.agentId === source.agentId), this.control.liveRunIds(sessionId));
  }

  /**
   * Continue a loop-stopped run of the session. Guarded per run (a second tap
   * while the first runs is refused) and per session (a turn in flight is busy).
   * The result lands as the session's next exchange, whatever its outcome: a run
   * that stops on a loop guard again is stored as a failed turn and stays
   * resumable.
   */
  async resume(sessionId: string, runId: string, input: Extract<ParsedResumeInput, { ok: true }>): Promise<ChatResumeOutcome> {
    const admitted = await this.admit(sessionId, runId);
    if (!admitted.ok) return admitted;
    try {
      let result: AgentResult;
      try {
        result = await admitted.agent.resumeRun(runId, continueOptions(input.options));
      } catch (e) {
        return { ok: false, ...resumeFailureOf(e) };
      }
      this.store(sessionId, result, input);
      // The cached engine did not see this exchange: rebuild its history from the DB.
      await this.host.evict(sessionId);
      return { ok: true, reply: replyOf(result), success: result.success, resumable: result.resumable === true };
    } finally {
      admitted.leave();
    }
  }

  /**
   * Continue a run as a live turn: the same checks and the same stored exchange as
   * {@link resume}, but the run's progress and end come as stream events
   * (`chat-resume-stream.ts`) for a detached turn to buffer, so the thread fills in
   * while the run works. The turn guard and the run's slot are held until the stream
   * ends or is dropped.
   */
  async startStream(
    sessionId: string,
    runId: string,
    input: Extract<ParsedResumeInput, { ok: true }>,
  ): Promise<{ readonly ok: true; readonly message: string; readonly events: AsyncGenerator<ChatStreamEvent> } | ({ readonly ok: false } & ResumeFailure)> {
    const admitted = await this.admit(sessionId, runId);
    if (!admitted.ok) return admitted;
    const { agent, leave } = admitted;
    const host = this.host;
    const store = (result: AgentResult, recorded: StoredTurnTrace | undefined): void => this.store(sessionId, result, input, recorded);
    const steps = host.strategyStepsOf?.(sessionId);
    async function* events(): AsyncGenerator<ChatStreamEvent> {
      let stored = false;
      // The strategy steps the continued run reports fold into the stored card, as on a normal turn.
      const recorder = new TurnTraceRecorder();
      try {
        // The exchange is stored before the terminal event reaches any client.
        for await (const event of resumeEventStream(agent, runId, continueOptions(input.options), (end) => {
          if ("result" in end) {
            store(end.result, recorder.finish());
            stored = true;
          }
        }, steps)) {
          if (event._tag === "StepEvent") recorder.record(event);
          yield event;
        }
      } finally {
        if (stored) await host.evict(sessionId).catch(() => undefined);
        leave();
      }
    }
    return { ok: true, message: continueMessage(input.options.note), events: events() };
  }

  /**
   * The checks shared by both forms of Continue: the run is not already being continued,
   * it is one of this chat's interrupted runs, no turn is in flight, and the agent builds.
   * On success the run's slot and the turn guard are held; `leave` releases both.
   */
  private async admit(
    sessionId: string,
    runId: string,
  ): Promise<{ readonly ok: true; readonly agent: ResumableAgent; readonly leave: () => void } | ({ readonly ok: false } & ResumeFailure)> {
    const slot = this.guard.claim(runId);
    if (!slot) return { ok: false, code: "busy", message: "This run is already being continued." };
    try {
      const listed = await this.list(sessionId);
      if (!listed.some((r) => r.runId === runId)) {
        slot();
        return {
          ok: false,
          code: "not-resumable",
          message: "That run is not an interrupted run of this chat, so it cannot be continued. Send a new message instead.",
        };
      }
      let release: () => void;
      try {
        release = this.host.acquireTurn(sessionId);
      } catch (e) {
        slot();
        return { ok: false, code: "busy", message: errorText(e) };
      }
      try {
        const agent = await this.host.agentFor(sessionId);
        return {
          ok: true,
          agent,
          leave: () => {
            release();
            slot();
          },
        };
      } catch (e) {
        release();
        slot();
        return { ok: false, ...resumeFailureOf(e) };
      }
    } catch (e) {
      slot();
      return { ok: false, ...resumeFailureOf(e) };
    }
  }

  /** Store the continued run's result as the session's next exchange ("Continue" and the reply). */
  private store(sessionId: string, result: AgentResult, input: Extract<ParsedResumeInput, { ok: true }>, recorded?: StoredTurnTrace): void {
    const outcome = result.success ? undefined : turnOutcomeOf(result);
    // The continuation is its own run: the turn is stamped with its parent so the thread, the Runs list and the trace drawer link them.
    const trace = withContinuedFrom(withTurnOutcome(recorded, outcome), result.continuedFrom);
    // The turn stores the run's id (`taskId`); a continuation's durable `runId` is the new run's own id, so it wins.
    const stored = result.continuedFrom !== undefined && result.runId !== undefined ? { ...result, taskId: result.runId } : result;
    this.host.persistExchange(sessionId, continueMessage(input.options.note), replyOf(result), stored, [], trace);
  }
}
