import type { AgentStreamEvent } from "@reactive-agents/runtime";
import {
  causeLineOf,
  finishTurnTrace,
  foldStrategyRun,
  foldTurnTrace,
  initialStrategyRun,
  initialTurnTrace,
  runNotesOf,
  strategyRunForStorage,
  strategyStepFromWire,
  type StrategyRunState,
  splitUnfinished,
  turnOutcomeOf as readTurnOutcome,
  type AttachmentMeta,
  type InterruptedBy,
  type RunCompletionLike,
  type RecalledMemoryView,
  type RunNotes,
  type RunSkillsView,
  type StepEvent,
  type TurnDeliverable,
  type TurnTrace,
  type UiStreamEvent,
  type UserInterrupt,
} from "@reactive-agents/ui-core";
import { storedRunError } from "./chat-run-errors.js";
import { cancelReasonOf } from "./chat-turn-stop.js";

/** Max chars of one tool result/error kept in a persisted turn trace. */
const STORED_RESULT_CAP = 4_000;

/**
 * How a stored turn's run ended when it did not succeed (ui-core `TurnEnding`,
 * minus the live-only kinds). `interrupted`: the turn was stopped before its run
 * completed (Stop, or the client went away).
 */
export type StoredTurnEnding = "failed" | "partial" | "abstained" | "interrupted";

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
  /** Interrupted turns, and a partial the user stopped (`"user"`): who stopped it. */
  readonly interruptedBy?: InterruptedBy;
  /** `"pause"` when the user's stop was a Pause; absent for a Stop (and on older rows). */
  readonly userInterrupt?: UserInterrupt;
}

/** Outcome of a turn that failed before the run could report (the agent threw, or could not be built). */
export function failedOutcome(raw: unknown): StoredTurnOutcome {
  const error = storedRunError(causeLineOf(raw));
  return { success: false, ending: "failed", ...(error ? { error } : {}) };
}

/** Outcome of a turn stopped before its run completed; the cause line is ui-core's `interruptionCause`. */
export function interruptedOutcome(by: InterruptedBy, how?: UserInterrupt): StoredTurnOutcome {
  const o = readTurnOutcome({ interrupted: cancelReasonOf(by, how) });
  return {
    success: false,
    ending: "interrupted",
    interruptedBy: by,
    ...(o.userInterrupt ? { userInterrupt: o.userInterrupt } : {}),
    ...(o.error ? { error: o.error } : {}),
  };
}

/**
 * The `StreamCompleted` a chat client gets for a turn that failed before the run
 * reported one (same shape as the runtime's failed completion: `output: ""`,
 * `success: false`, the cause on `error`), so the UI takes its one failure path.
 */
export function failedCompletion(outcome: StoredTurnOutcome): AgentStreamEvent {
  return {
    _tag: "StreamCompleted",
    output: "",
    success: false,
    ...(outcome.error ? { error: outcome.error } : {}),
    metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0 },
  };
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
  /** Skills the run had active and why (ui-core `foldRunSkills`, `chat-turn-skills.ts`). */
  readonly skills?: RunSkillsView;
  /** Memories the run recalled into its context (ui-core `foldRecalledMemories`, `chat-turn-recall.ts`); absent when it reported none. */
  readonly recalled?: readonly RecalledMemoryView[];
  /** What the user attached to the message (a user row only): names and sizes, never bytes. */
  readonly attachments?: readonly AttachmentMeta[];
  /** The run this turn's run continues (`resumeRun({ newRun: true })`, Continue); absent for an ordinary turn. */
  readonly continuedFrom?: string;
  /**
   * The strategy's folded phases (ui-core `strategyRunForStorage`: settled, long text clipped, rows bounded),
   * so the strategy card survives the turn ending and a reload. Absent on older rows and for a strategy that reported none.
   */
  readonly strategyRun?: StrategyRunState;
  /**
   * What the run reported about how it ended, beyond success or failure (ui-core `runNotesOf`): the to-do
   * outcome with its harness closures and unresolved rows, an answer written from unread tool results,
   * and the terminal authority. Absent on older rows and for a run that reported none.
   */
  readonly runNotes?: RunNotes;
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
  // A user stop is a partial with no cause: the bus's generic note is not one.
  const error = o.interruptedBy === "user" ? undefined : (storedRunError(o.error) ?? busError);
  return {
    success: false,
    ending: o.ending,
    ...(o.ending === "partial" && o.interruptedBy ? { interruptedBy: o.interruptedBy } : {}),
    ...(o.ending === "partial" && o.userInterrupt ? { userInterrupt: o.userInterrupt } : {}),
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
  const ending =
    o["ending"] === "partial" || o["ending"] === "abstained" || o["ending"] === "interrupted" ? o["ending"] : "failed";
  const by = o["interruptedBy"] === "user" || o["interruptedBy"] === "disconnect" ? o["interruptedBy"] : undefined;
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
    ...((ending === "interrupted" || ending === "partial") && by !== undefined ? { interruptedBy: by } : {}),
    ...((ending === "interrupted" || ending === "partial") && by === "user" && o["userInterrupt"] === "pause" ? { userInterrupt: "pause" as const } : {}),
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
  if (outcome.ending === "partial" && outcome.interruptedBy === "user") {
    // The user's own stop: the answer so far is real work, kept in history with a marker.
    const mark = "[The user stopped this reply here; the answer above is the work so far.]";
    const answer = (splitUnfinished(turn.content)?.draft ?? turn.content).trim();
    return answer.length > 0 ? `${answer}\n\n${mark}` :"[The user stopped the previous reply before any answer was written.]";
  }
  const how = outcome.terminatedBy && outcome.terminatedBy !== "abstained" ? ` (${outcome.terminatedBy})` : "";
  if (outcome.ending === "abstained") {
    const reason = outcome.abstention?.reason ?? outcome.error;
    return `[The previous run abstained${reason ? `: ${reason}` : ""}. No answer was given.]`;
  }
  if (outcome.ending === "interrupted") {
    // Partial streamed text may be narration, not an answer: the model is told the reply was cut off.
    const by =
      outcome.interruptedBy === "user" ? " (stopped by the user)" : outcome.interruptedBy === "disconnect" ? " (the user's connection closed)" : "";
    return `[The previous reply was interrupted${by} before it finished. No answer was given.]`;
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

/** Mark a turn trace as the continuation of `parentRunId`'s run, creating an empty trace when the turn had none. */
export function withContinuedFrom(trace: StoredTurnTrace | undefined, parentRunId: string | undefined): StoredTurnTrace | undefined {
  if (parentRunId === undefined || parentRunId === "") return trace;
  return { ...(trace ?? { reasoningSteps: [], toolCalls: [] }), continuedFrom: parentRunId };
}

/**
 * Accumulates one chat turn's stream into the persisted trace using the SAME
 * fold the live UI renders from (`@reactive-agents/ui-core` turn-trace), so a
 * reloaded turn can never classify thinking/answer/tool calls differently from
 * how it streamed.
 */
export class TurnTraceRecorder {
  private state = initialTurnTrace();
  private strategy = initialStrategyRun;
  private notes: RunNotes | undefined;

  record(event: AgentStreamEvent | StepEvent): void {
    // The runtime's AgentStreamEvent is the producer of the wire union ui-core consumes.
    const ui = event as UiStreamEvent;
    this.state = foldTurnTrace(this.state, ui);
    if (event._tag === "StreamCompleted") this.notes = runNotesOf(event);
    // StepEvent is in the ui-core wire union; the runtime's own event type does not list it.
    if (ui._tag === "StepEvent") {
      const step = strategyStepFromWire(ui.step);
      if (step) this.strategy = foldStrategyRun(this.strategy, step);
    }
  }

  /**
   * Record the strategy `StepEvent`s a chat turn drained from its `StrategyStepLog` and hand them back
   * to be streamed. These never pass through the runtime's stream (they come from the agent's bus), so
   * the stream loop's `record` cannot see them: this is the one place they reach the stored card.
   */
  recordSteps(steps: readonly StepEvent[]): readonly StepEvent[] {
    for (const step of steps) this.record(step);
    return steps;
  }

  /**
   * Trace to persist, or `undefined` when the turn had neither thinking nor tool
   * calls. ui-core's `outcome` is replaced by Cortex's stored shape
   * (`withTurnOutcome`); only its receipt deliverables are kept here.
   */
  finish(): StoredTurnTrace | undefined {
    const trace = finishTurnTrace(this.state, { resultCap: STORED_RESULT_CAP });
    const strategyRun = strategyRunForStorage(this.strategy);
    const runNotes = this.notes !== undefined ? { runNotes: this.notes } : {};
    // A strategy card or the run's notes are worth keeping even for a turn with no thinking or tool calls.
    if (trace === undefined) {
      return strategyRun || this.notes ? { reasoningSteps: [], toolCalls: [], ...(strategyRun ? { strategyRun } : {}), ...runNotes } : undefined;
    }
    const { outcome, ...rest } = trace;
    return { ...rest, ...(outcome?.deliverables ? { deliverables: outcome.deliverables } : {}), ...(strategyRun ? { strategyRun } : {}), ...runNotes };
  }
}

/** A user row's trace carrying only the message's attachment metadata. */
export function withTurnAttachments(attachments: readonly AttachmentMeta[]): StoredTurnTrace {
  return { reasoningSteps: [], toolCalls: [], attachments: [...attachments] };
}

const ATTACHMENT_KINDS: ReadonlySet<string> = new Set(["image", "audio", "text", "workspace-file"]);

/** Stored attachment metadata read back from JSON (well-formed entries only). */
export function readStoredAttachments(raw: unknown): readonly AttachmentMeta[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.flatMap((a): AttachmentMeta[] => {
    if (a === null || typeof a !== "object") return [];
    const o = a as Readonly<Record<string, unknown>>;
    const kind = o["kind"];
    const name = o["name"];
    const bytes = o["bytes"];
    if (typeof kind !== "string" || !ATTACHMENT_KINDS.has(kind) || !str(name) || typeof bytes !== "number") return [];
    return [{
      kind: kind as AttachmentMeta["kind"],
      name,
      bytes,
      ...(str(o["mediaType"]) ? { mediaType: o["mediaType"] } : {}),
      ...(str(o["path"]) ? { path: o["path"] } : {}),
      ...(typeof o["shownBytes"] === "number" ? { shownBytes: o["shownBytes"] } : {}),
    }];
  });
  return list.length > 0 ? list : undefined;
}
