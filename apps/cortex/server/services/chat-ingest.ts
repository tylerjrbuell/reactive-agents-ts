/**
 * Feeds a chat agent's event bus into the Cortex ingest path in-process (the same
 * `CortexIngestService.handleEvent` Lab and gateway runs use), so sub-agents
 * spawned in a chat turn become their own run rows on the Beacon grid.
 *
 * Runs are keyed by the event's `taskId`, matching `CortexReporter`: a spawned
 * child has its own task id, so it lands on its own row instead of folding into
 * the parent's. Only the chat's ROOT runs (an `AgentStarted` with no
 * `parentRunId`) carry the chat `sessionId`, so a grid node links back to its chat.
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

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Subscribe `agent` to `sink`; returns the unsubscribe. */
export async function attachChatIngest(
  agent: SubscribableAgent,
  sink: ChatIngestSink,
  opts: { readonly sessionId: string; readonly stableAgentId?: string },
): Promise<() => void> {
  const chatRoots = new Set<string>();
  return agent.subscribe((event) => {
    const e = event as { readonly _tag: string } & Readonly<Record<string, unknown>>;
    const taskId = str(e.taskId);
    if (taskId === undefined) return;
    if (e._tag === "AgentStarted" && str(e.parentRunId) === undefined) chatRoots.add(taskId);
    // A child's own agentId is its identity; the chat's stable id only labels the root.
    const agentId = str(e.agentId) ?? (chatRoots.has(taskId) ? opts.stableAgentId : undefined) ?? taskId;
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
  });
}
