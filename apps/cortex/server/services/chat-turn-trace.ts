import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { finishTurnTrace, foldTurnTrace, initialTurnTrace, type TurnTrace, type UiStreamEvent } from "@reactive-agents/ui-core";

/** Max chars of one tool result/error kept in a persisted turn trace. */
const STORED_RESULT_CAP = 4_000;

/** What a reloaded chat needs to re-render a turn's thinking and tool calls. */
export type StoredTurnTrace = TurnTrace;

/**
 * Accumulates one chat turn's stream into the persisted trace using the SAME
 * fold the live UI renders from (`@reactive-agents/ui-core` turn-trace), so a
 * reloaded turn can never classify thinking/answer/tool calls differently from
 * how it streamed.
 */
export class TurnTraceRecorder {
  private state = initialTurnTrace();

  record(event: AgentStreamEvent): void {
    // The runtime's AgentStreamEvent is the producer of the wire union ui-core consumes.
    this.state = foldTurnTrace(this.state, event as UiStreamEvent);
  }

  /** Trace to persist, or `undefined` when the turn had neither thinking nor tool calls. */
  finish(): StoredTurnTrace | undefined {
    return finishTurnTrace(this.state, { resultCap: STORED_RESULT_CAP });
  }
}
