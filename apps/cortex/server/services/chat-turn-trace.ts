import type { AgentStreamEvent } from "@reactive-agents/runtime";
import {
  finishTurnTrace,
  foldTurnTrace,
  initialTurnTrace,
  turnOutcomeOf as readTurnOutcome,
  type RunCompletionLike,
  type TurnDeliverable,
  type TurnTrace,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import { storedRunError } from "./chat-run-errors.js";

/** Max chars of one tool result/error kept in a persisted turn trace. */
const STORED_RESULT_CAP = 4_000;

/** How a stored turn's run ended when it did not succeed (ui-core `TurnEnding`, minus the live-only kinds). */
export type StoredTurnEnding = "failed" | "partial" | "abstained";

/**
 * A turn whose run did not succeed. Its content is then empty, a partial draft,
 * or the model's own last text, never an answer, so the UI marks it instead of
 * rendering it as one.
 */
export interface StoredTurnOutcome {
  readonly success: false;
  /** Absent on rows written before 2026-11-10: read as `failed`. */
  readonly ending?: StoredTurnEnding;
  readonly terminatedBy?: string;
  /** The run's cause (`StreamCompleted.error`, else the bus's `ReasoningFailed` / `AgentCompleted.error`), first line. */
  readonly error?: string;
  /** Abstained runs: why the agent declined and what it was missing. */
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  /** Partial runs: the items left unfinished. */
  readonly unfinished?: readonly string[];
}

/**
 * What a reloaded chat needs to re-render a turn's thinking and tool calls, a
 * failed run's outcome, and the files a run produced (its answer when the
 * output is empty). Cortex stores its own `outcome` shape (kept readable for
 * older rows), not ui-core's.
 */
export type StoredTurnTrace = Omit<TurnTrace, "outcome"> & {
  readonly outcome?: StoredTurnOutcome;
  /** Declared deliverables from the run's receipt, when it listed any. */
  readonly deliverables?: readonly TurnDeliverable[];
};

/**
 * Outcome to persist from a turn's `StreamCompleted`: only a run that ended
 * failed, partial or abstained (ui-core `turnOutcomeOf` classifies it from the
 * framework fields). The cause is the event's own `error`; `busError`
 * (`chat-run-errors.ts`) fills in for emitters that predate it.
 */
export function turnOutcomeOf(event: RunCompletionLike, busError?: string): StoredTurnOutcome | undefined {
  const o = readTurnOutcome(event);
  if (o.ending !== "failed" && o.ending !== "partial" && o.ending !== "abstained") return undefined;
  const error = storedRunError(o.error) ?? busError;
  return {
    success: false,
    ending: o.ending,
    ...(o.terminatedBy ? { terminatedBy: o.terminatedBy } : {}),
    ...(error ? { error } : {}),
    ...(o.abstention ? { abstention: o.abstention } : {}),
    ...(o.unfinished && o.unfinished.length > 0 ? { unfinished: o.unfinished } : {}),
  };
}

/** Receipt deliverables of a `StreamCompleted`, when it listed any. */
export function turnDeliverablesOf(event: RunCompletionLike): readonly TurnDeliverable[] | undefined {
  return readTurnOutcome(event).deliverables;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * A stored `outcome` read back from JSON. Rows written before the ending kinds
 * existed carry only `success`, `terminatedBy` and `error`: they read as failed.
 */
export function readStoredOutcome(raw: unknown): StoredTurnOutcome | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Readonly<Record<string, unknown>>;
  if (o["success"] !== false) return undefined;
  const ending = o["ending"] === "partial" || o["ending"] === "abstained" ? o["ending"] : "failed";
  const ab = o["abstention"] as Readonly<Record<string, unknown>> | undefined;
  const missing = Array.isArray(ab?.["missing"]) ? ab["missing"].filter(str) : [];
  const unfinished = Array.isArray(o["unfinished"]) ? o["unfinished"].filter(str) : [];
  return {
    success: false,
    ending,
    ...(str(o["terminatedBy"]) ? { terminatedBy: o["terminatedBy"] } : {}),
    ...(str(o["error"]) ? { error: o["error"] } : {}),
    ...(ab && str(ab["reason"]) ? { abstention: { reason: ab["reason"], ...(missing.length > 0 ? { missing } : {}) } } : {}),
    ...(unfinished.length > 0 ? { unfinished } : {}),
  };
}

/** Stored deliverables read back from JSON (`{ spec, produced }` entries only). */
export function readStoredDeliverables(raw: unknown): readonly TurnDeliverable[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter(
    (d): d is TurnDeliverable =>
      d !== null && typeof d === "object" && str((d as { spec?: unknown }).spec) && typeof (d as { produced?: unknown }).produced === "boolean",
  );
  return list.length > 0 ? list.map((d) => ({ spec: d.spec, produced: d.produced })) : undefined;
}

/**
 * The `StreamCompleted` sent to the chat client, with the run's cause on `error`
 * when the runtime's event did not carry one (the bus cause, `chat-run-errors.ts`).
 * Other events pass through.
 */
export function withRunError(event: AgentStreamEvent, outcome: StoredTurnOutcome | undefined): AgentStreamEvent {
  if (event._tag !== "StreamCompleted" || outcome?.error === undefined || event.error) return event;
  return { ...event, error: outcome.error };
}

/**
 * What a stored assistant turn contributes to the next turn's chat history. A
 * failed run's text is its last narration (or nothing), never an answer:
 * sending it as the assistant's reply made the model continue from it (trace
 * 01M73GND, 2026-11-10). The turn is kept in history, marked with how it ended
 * and why, so the conversation still alternates and the model knows the ask
 * went unanswered. A successful turn whose answer was a file (empty content)
 * names the files it produced, so the history never holds an empty reply.
 */
export function historyContentOf(turn: { readonly content: string; readonly trace?: StoredTurnTrace }): string {
  const outcome = turn.trace?.outcome;
  if (outcome?.success !== false) {
    if (turn.content.trim().length > 0) return turn.content;
    const produced = (turn.trace?.deliverables ?? []).filter((d) => d.produced).map((d) => d.spec);
    return produced.length > 0 ? `[The previous run produced: ${produced.join("; ")}.]` : turn.content;
  }
  const how = outcome.terminatedBy && outcome.terminatedBy !== "abstained" ? ` (${outcome.terminatedBy})` : "";
  if (outcome.ending === "abstained") {
    const reason = outcome.abstention?.reason ?? outcome.error;
    return `[The previous run abstained${reason ? `: ${reason}` : ""}. No answer was given.]`;
  }
  const cause = outcome.error ? `: ${outcome.error}` : "";
  return `[The previous run failed${how}${cause}. No answer was given.]`;
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

  /**
   * Trace to persist, or `undefined` when the turn had neither thinking nor tool
   * calls. ui-core's `outcome` is replaced by Cortex's stored shape
   * (`withTurnOutcome`); only its receipt deliverables are kept here.
   */
  finish(): StoredTurnTrace | undefined {
    const trace = finishTurnTrace(this.state, { resultCap: STORED_RESULT_CAP });
    if (trace === undefined) return undefined;
    const { outcome, ...rest } = trace;
    return { ...rest, ...(outcome?.deliverables ? { deliverables: outcome.deliverables } : {}) };
  }
}
