import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { finishTurnTrace, foldTurnTrace, initialTurnTrace, type TurnTrace, type UiStreamEvent } from "@reactive-agents/ui-core";

/** Max chars of one tool result/error kept in a persisted turn trace. */
const STORED_RESULT_CAP = 4_000;

/**
 * A turn whose run did not succeed. Its reply is then the harness's failure
 * notice, not an answer, so the UI marks it instead of rendering it as one.
 */
export interface StoredTurnOutcome {
  readonly success: false;
  readonly terminatedBy?: string;
}

/** What a reloaded chat needs to re-render a turn's thinking and tool calls, plus a failed run's outcome. */
export type StoredTurnTrace = TurnTrace & { readonly outcome?: StoredTurnOutcome };

/** Outcome to persist from a turn's `StreamCompleted`: only a run that reported `success: false`. */
export function turnOutcomeOf(event: { readonly success?: boolean; readonly terminatedBy?: string }): StoredTurnOutcome | undefined {
  if (event.success !== false) return undefined;
  return { success: false, ...(event.terminatedBy ? { terminatedBy: event.terminatedBy } : {}) };
}

/** Attach a failed outcome to the turn trace, creating an empty trace when the turn had none. */
export function withTurnOutcome(
  trace: StoredTurnTrace | undefined,
  outcome: StoredTurnOutcome | undefined,
): StoredTurnTrace | undefined {
  if (!outcome) return trace;
  return { ...(trace ?? { reasoningSteps: [], toolCalls: [] }), outcome };
}

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
