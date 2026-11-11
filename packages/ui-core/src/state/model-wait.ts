import type { UiStreamEvent } from "../protocol/events.js";

/**
 * Whether a run is waiting on the model: a request went out and no token has
 * come back yet. A local server that is loading the model or serving other
 * requests holds the call here for a long time (a turn read "Thinking" with
 * 0 tokens for 1m39s while Ollama was busy). Without this state a UI cannot
 * tell that wait from the model thinking.
 *
 * The stream carries no "request sent" event, so the wait is derived from the
 * time to first token: it starts when the turn is sent and again when the
 * last running tool finishes (the next model call goes out), and ends at the
 * first text, thinking, thought or usage report, a tool call, or a terminal
 * event. Pure: the caller passes the clock.
 */
export interface ModelWaitState {
  /** True while a model call is out and nothing came back yet. */
  readonly waiting: boolean;
  /** Epoch ms the current wait began; absent when not waiting or no clock was given. */
  readonly since?: number;
  /** Tool calls started and not yet completed. */
  readonly toolsRunning: number;
}

/** The state right after a request is sent: waiting since `now`. */
export const initialModelWait = (now?: number): ModelWaitState => ({
  waiting: true,
  ...(now !== undefined ? { since: now } : {}),
  toolsRunning: 0,
});

const idle = (s: ModelWaitState): ModelWaitState => (s.waiting ? { waiting: false, toolsRunning: s.toolsRunning } : s);

/** Fold one stream event into the wait state. `now` stamps a wait that begins on this event. */
export function foldModelWait(s: ModelWaitState, event: UiStreamEvent, now?: number): ModelWaitState {
  switch (event._tag) {
    case "TextDelta":
    case "ThinkingEmitted":
    case "ThoughtEmitted":
    case "TokenUsage":
      return idle(s);
    case "ToolCallStarted":
      return { waiting: false, toolsRunning: s.toolsRunning + 1 };
    case "ToolCallCompleted": {
      const toolsRunning = Math.max(0, s.toolsRunning - 1);
      // The last tool finished: the model's next call is out.
      return toolsRunning === 0
        ? { waiting: true, ...(now !== undefined ? { since: now } : {}), toolsRunning }
        : { ...s, toolsRunning };
    }
    case "StreamCompleted":
    case "StreamError":
    case "StreamCancelled":
    case "RunPaused":
    case "LimitExceeded":
      return { waiting: false, toolsRunning: 0 };
    default:
      return s;
  }
}

/**
 * What a UI calls the wait. Ollama serves one request per loaded model at a
 * time and loads models on demand, so a waiting Ollama call is loading or
 * queued; other providers get the plain label.
 */
export function modelWaitLabel(provider: string | undefined): string {
  return provider === "ollama" ? "Waiting for Ollama (loading the model or queued)" : "Waiting for the model";
}
