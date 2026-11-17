/**
 * Pause or stop a chat session's running durable turn: the session's cached agent
 * (never built here: a session with no live agent has nothing running) is asked
 * through `run-interrupt.ts` (`agent.pauseRun` / `agent.stopRun`), which ends the
 * run at its next step with a saved place to continue from. The reply of that turn
 * is then a failed, resumable one: `chat-resume.ts` lists it and Continue resumes it.
 */
import { interruptLiveRun, type InterruptableAgent, type InterruptKind, type InterruptOutcome } from "./run-interrupt.js";

/** What chat pause / stop need from the chat session service (injected). */
export interface ChatRunControlHost {
  /** The session's cached agent, or `undefined` when none is live (nothing is running). */
  liveAgentOf(sessionId: string): InterruptableAgent | undefined;
}

export class ChatRunControl {
  constructor(private readonly host: ChatRunControlHost) {}

  /** Ids of the durable runs live in the session's agent now (`agent.activeRunIds()`); empty when none. */
  liveRunIds(sessionId: string): readonly string[] {
    return this.host.liveAgentOf(sessionId)?.activeRunIds() ?? [];
  }

  /**
   * Pause or stop the session's running durable turn. `not-live` when the session has no
   * live agent or its run is not durable (the caller then falls back to aborting the turn).
   */
  async interrupt(sessionId: string, kind: InterruptKind, graceMs?: number): Promise<InterruptOutcome> {
    const agent = this.host.liveAgentOf(sessionId);
    return agent === undefined ? "not-live" : interruptLiveRun(agent, kind, graceMs);
  }
}

/** What {@link interruptChatTurn} needs from the chat session service. */
export interface ChatTurnInterruptPorts {
  readonly resume: { readonly control: ChatRunControl };
  /** Abort the session's streamed turn as the user (`false` when none is in flight); `kind` makes the thread read paused or stopped. */
  stopTurn(sessionId: string, kind?: InterruptKind): boolean;
}

/** What Pause / Stop answers: whether a turn was ended and how the run's end was saved. */
export interface ChatInterruptAnswer {
  /** A turn was running and is now ended. */
  readonly stopped: boolean;
  /** The durable run ended with a saved place to continue from. */
  readonly persisted: boolean;
  readonly outcome: InterruptOutcome;
}

/**
 * The chat Stop / Pause: the framework ends the durable run first (a saved place to
 * continue from, `pauseRun` / `stopRun`), then the streamed turn is aborted as the user
 * so the thread reads "stopped by you" (or "paused by you" for a Pause) at once. A session whose run is not durable only
 * gets the abort (what Stop did before).
 */
export async function interruptChatTurn(
  svc: ChatTurnInterruptPorts,
  sessionId: string,
  kind: InterruptKind,
): Promise<ChatInterruptAnswer> {
  const outcome = await svc.resume.control.interrupt(sessionId, kind);
  // A Pause that saved nothing (the run is not durable) is a Stop: the thread must not say "paused".
  const aborted = svc.stopTurn(sessionId, kind === "pause" && outcome === "not-live" ? "stop" : kind);
  return { stopped: aborted || outcome !== "not-live", persisted: outcome === "persisted", outcome };
}
