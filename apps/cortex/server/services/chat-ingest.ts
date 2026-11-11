/**
 * Feeds a chat agent's event bus into the Cortex ingest path in-process (the same
 * `CortexIngestService.handleEvent` Lab and gateway runs use), so sub-agents
 * spawned in a chat turn become their own run rows on the Beacon grid.
 *
 * Runs are keyed by the event's `taskId`, matching `CortexReporter`: a spawned
 * child has its own task id, so it lands on its own row instead of folding into
 * the parent's. Only the chat's ROOT runs (an `AgentStarted` with no
 * `parentRunId`) carry the chat `sessionId`, so a grid node links back to its chat.
 *
 * A turn aborted mid-run (Stop, or the client going away) gets no terminal bus
 * event from the runtime, so its runs would stay `live` forever. The handle
 * tracks runs that started and have not ended, and `closeOpenRuns` ends them
 * through the same ingest path: `ExecutionCancelled` (status `stopped`) or
 * `TaskFailed` (status `failed`).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import { CortexError } from "../errors.js";
import type { CortexIngestMessage } from "../types.js";

/** The slice of `CortexIngestService` chat needs. */
export interface ChatIngestSink {
  readonly handleEvent: (
    agentId: string,
    runId: string,
    msg: CortexIngestMessage,
  ) => Effect.Effect<void, CortexError>;
}

/** The slice of a built agent chat needs: bus subscription. */
export interface SubscribableAgent {
  readonly subscribe: (handler: (event: AgentEvent) => void) => Promise<() => void>;
}

/** How to end the runs a turn left open. */
export type OpenRunEnd = { readonly kind: "stopped" } | { readonly kind: "failed"; readonly error: string };

/** A chat agent's ingest subscription. */
export interface ChatIngestHandle {
  /** Unsubscribe from the agent's bus. */
  readonly detach: () => void;
  /** Start a new turn: only runs started from now on are this turn's to close. */
  readonly beginTurn: () => void;
  /**
   * End every run this turn started that has not reported an end (a turn that
   * was aborted or broke). Runs of earlier turns (a durable run paused on an
   * approval) are left alone.
   */
  readonly closeOpenRuns: (end: OpenRunEnd) => void;
  /**
   * The arguments a tool call started with, from the bus `ToolCallStarted`
   * (core carries them post-heal), for this turn's calls. `undefined` when the
   * bus event had none or the call is unknown.
   */
  readonly startedArgsOf: (callId: string) => unknown;
}

/**
 * A stream `ToolCallStarted` with its arguments filled from the bus when the
 * stream event has none, so a chat can show a long-running call's arguments
 * before it completes. Every other event passes through unchanged.
 */
export function withStartedArgs<E extends { readonly _tag: string }>(
  event: E,
  argsOf: ((callId: string) => unknown) | undefined,
): E {
  if (event._tag !== "ToolCallStarted" || argsOf === undefined) return event;
  const e = event as E & { readonly callId?: unknown; readonly args?: unknown };
  if (e.args !== undefined || typeof e.callId !== "string") return event;
  const args = argsOf(e.callId);
  return args === undefined ? event : { ...event, args };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const ENDS: ReadonlySet<string> = new Set(["AgentCompleted", "TaskFailed", "ExecutionCancelled"]);

/** Subscribe `agent` to `sink`. */
export async function attachChatIngest(
  agent: SubscribableAgent,
  sink: ChatIngestSink,
  opts: { readonly sessionId: string; readonly stableAgentId?: string },
): Promise<ChatIngestHandle> {
  const chatRoots = new Set<string>();
  // Runs of the current turn that started and have not ended.
  let open = new Set<string>();
  const agentIdOf = (taskId: string, own: string | undefined): string =>
    own ?? (chatRoots.has(taskId) ? opts.stableAgentId : undefined) ?? taskId;
  const agentIds = new Map<string, string>();
  // This turn's started-call arguments by call id (cleared each turn).
  let startedArgs = new Map<string, unknown>();

  const send = (taskId: string, agentId: string, event: AgentEvent): void => {
    const msg: CortexIngestMessage = {
      v: 1,
      agentId,
      runId: taskId,
      ...(chatRoots.has(taskId) ? { sessionId: opts.sessionId } : {}),
      event,
    };
    Effect.runFork(
      sink.handleEvent(agentId, taskId, msg).pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({ site: "cortex/server/services/chat-ingest.ts", tag: errorTag(err) }),
        ),
      ),
    );
  };

  const detach = await agent.subscribe((event) => {
    const e = event as { readonly _tag: string } & Readonly<Record<string, unknown>>;
    if (e._tag === "ToolCallStarted" && e.args !== undefined) {
      const callId = str(e.callId);
      if (callId !== undefined) startedArgs.set(callId, e.args);
    }
    const taskId = str(e.taskId);
    if (taskId === undefined) return;
    if (e._tag === "AgentStarted") {
      if (str(e.parentRunId) === undefined) chatRoots.add(taskId);
      open.add(taskId);
    } else if (ENDS.has(e._tag)) {
      open.delete(taskId);
    }
    // A child's own agentId is its identity; the chat's stable id only labels the root.
    const agentId = agentIdOf(taskId, str(e.agentId));
    agentIds.set(taskId, agentId);
    send(taskId, agentId, event);
  });

  return {
    detach,
    beginTurn: () => {
      open = new Set();
      startedArgs = new Map();
    },
    startedArgsOf: (callId) => startedArgs.get(callId),
    closeOpenRuns: (end) => {
      for (const taskId of [...open]) {
        open.delete(taskId);
        const event: AgentEvent =
          end.kind === "stopped"
            ? { _tag: "ExecutionCancelled", taskId }
            : { _tag: "TaskFailed", taskId, error: end.error };
        send(taskId, agentIds.get(taskId) ?? agentIdOf(taskId, undefined), event);
      }
    },
  };
}
