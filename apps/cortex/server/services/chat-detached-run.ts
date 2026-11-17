/**
 * Server-started chat turns (goal segments, schedule and loop fires) run as detached streamed
 * turns, so the open chat shows them live like a user turn: the same {@link DetachedTurns}
 * buffer feeds `GET .../chat/active` and `GET .../chat/stream/active`, and a reloaded page
 * re-attaches. The caller still gets a `CortexChatResult` when the turn ends.
 */
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { isUserStopResult } from "@reactive-agents/ui-core";
import type { DetachedTurns } from "./chat-detached-turn.js";
import { ChatTurnFailedError } from "../errors.js";
import {
  ChatApprovalPendingError,
  ChatSessionBusyError,
  type ChatSessionService,
  type CortexChatResult,
} from "./chat-session-service.js";

/** The slice of {@link ChatSessionService} the runner uses. */
export type DetachedRunHost = Pick<
  ChatSessionService,
  "isBusy" | "approvals" | "chatStream" | "beginTurnAssessments" | "drainTurnAssessments"
>;

type Completed = Extract<AgentStreamEvent, { _tag: "StreamCompleted" }>;

/**
 * A turn runner with the `chat()` contract (rejects with `ChatSessionBusyError` while the session
 * is busy) that streams the turn through `turns`.
 */
export function makeDetachedRunner(
  host: DetachedRunHost,
  turns: DetachedTurns,
): (sessionId: string, message: string) => Promise<CortexChatResult> {
  return async (sessionId, message) => {
    if (host.approvals.hasPending(sessionId)) throw new ChatApprovalPendingError(sessionId);
    if (host.isBusy(sessionId) || turns.running(sessionId)) throw new ChatSessionBusyError(sessionId);

    host.beginTurnAssessments(sessionId);
    const turn = turns.start(sessionId, message, host.chatStream(sessionId, message));
    let done: Completed | undefined;
    let failure: string | undefined;
    for await (const { event } of turn.attach(0)) {
      if (event._tag === "StreamCompleted") done = event;
      else if (event._tag === "StreamError") failure = event.cause;
      else if (event._tag === "StreamCancelled") failure = "The turn was stopped before it finished";
    }
    // The stored turn is written after the last event: wait for the producer's cleanup.
    await turn.whenEnded();

    if (failure !== undefined) throw new ChatTurnFailedError({ message: failure });
    if (done === undefined) throw new ChatTurnFailedError({ message: "The turn ended without a result" });
    // A turn the user stopped is a partial (its answer so far is the reply), not a failure.
    if (done.success === false && done.status === undefined && done.error && !isUserStopResult(done)) throw new ChatTurnFailedError({ message: done.error });

    const assessed = host.drainTurnAssessments(sessionId);
    const turnEvents =
      assessed.length > 0
        ? assessed
        : typeof done.evidenceDelta === "number"
          ? [{ _tag: "AssessmentEmitted" as const, evidenceDelta: done.evidenceDelta }]
          : [];
    const toolsUsed = done.toolSummary?.map((t) => t.name) ?? [];
    return {
      reply: done.output,
      tokensUsed: done.metadata?.tokensUsed ?? 0,
      ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
      ...(done.metadata?.stepsCount != null ? { steps: done.metadata.stepsCount } : {}),
      ...(done.metadata?.cost != null ? { cost: done.metadata.cost } : {}),
      turnEvents,
      ...(done.goalAchieved !== undefined ? { goalAchieved: done.goalAchieved } : {}),
    };
  };
}
