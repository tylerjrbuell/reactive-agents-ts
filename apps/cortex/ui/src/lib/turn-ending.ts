/**
 * How a chat turn or desk run ended, for display. The framework never writes
 * harness text into `output`: a failed or abstained run completes with
 * `output: ""` and its cause on `error`, a partial run ships the model's draft
 * plus an `Unfinished:` list, and a run whose answer is a file can succeed with
 * empty output (its files are on `receipt.deliverables`). ui-core's
 * `turnOutcomeOf` classifies those fields; this module adapts its result to
 * Cortex's turn shape and to the labels the views render.
 */
import {
  causeLineOf,
  splitUnfinished,
  turnOutcomeOf,
  type InterruptedBy,
  type TurnDeliverable,
  type TurnOutcome,
} from "@reactive-agents/ui-core";
import { runErrorLine } from "./run-error.js";

/**
 * A turn whose run did not succeed: failed, partial (a draft with unfinished
 * items), abstained, or interrupted (stopped by the user or a dropped connection
 * before the run completed).
 */
export interface TurnRunEnding {
  /** Absent on turns stored before 2026-11-10: read as `failed`. */
  readonly ending?: "failed" | "partial" | "abstained" | "interrupted";
  readonly terminatedBy?: string;
  /** The run's cause (`StreamCompleted.error`, or the server's stored outcome). */
  readonly error?: string;
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  readonly unfinished?: readonly string[];
  /** Interrupted turns: who stopped it. */
  readonly interruptedBy?: InterruptedBy;
}

/**
 * The ending of a turn that failed before any stream content (the request was
 * refused or the network failed): failed, with the cause line minus its error
 * class tag (`TypeError: Failed to fetch` → `Failed to fetch`).
 */
export function failedBeforeStream(cause: unknown): TurnRunEnding {
  const error = causeLineOf(cause);
  return { ending: "failed", ...(error ? { error } : {}) };
}

/** Ending of a `StreamCancelled` (its `reason` is who stopped it: `user` or `disconnect`). */
export function cancelledEnding(reason: string): TurnRunEnding {
  return runEndingOf(turnOutcomeOf({ interrupted: reason === "user" || reason === "disconnect" ? reason : true }));
}

/** What a finished `StreamCompleted` tells a chat turn: how it ended (when not success) and the files it produced. */
export interface CompletionEnding {
  readonly runFailed?: TurnRunEnding;
  readonly deliverables?: readonly TurnDeliverable[];
}

const NOT_SUCCESS = new Set(["failed", "partial", "abstained", "interrupted"]);

/** Ending of a `StreamCompleted` event (or any result-shaped object). Paused and successful runs set no `runFailed`. */
export function completionEnding(event: object): CompletionEnding {
  const o = turnOutcomeOf(event);
  return {
    ...(NOT_SUCCESS.has(o.ending) ? { runFailed: runEndingOf(o) } : {}),
    ...(o.deliverables ? { deliverables: o.deliverables } : {}),
  };
}

const runEndingOf = (o: TurnOutcome): TurnRunEnding => ({
  ending: o.ending as NonNullable<TurnRunEnding["ending"]>,
  ...(o.terminatedBy ? { terminatedBy: o.terminatedBy } : {}),
  ...(o.error ? { error: o.error } : {}),
  ...(o.abstention ? { abstention: o.abstention } : {}),
  ...(o.unfinished && o.unfinished.length > 0 ? { unfinished: o.unfinished } : {}),
  ...(o.interruptedBy ? { interruptedBy: o.interruptedBy } : {}),
});

/** A server-stored outcome (`trace.outcome`) as a turn ending; fields absent on older rows stay absent. */
export function storedRunEnding(o: TurnRunEnding): TurnRunEnding {
  return {
    ...(o.ending ? { ending: o.ending } : {}),
    ...(o.terminatedBy ? { terminatedBy: o.terminatedBy } : {}),
    ...(o.error ? { error: o.error } : {}),
    ...(o.abstention ? { abstention: o.abstention } : {}),
    ...(o.unfinished && o.unfinished.length > 0 ? { unfinished: o.unfinished } : {}),
    ...(o.ending === "interrupted" && (o.interruptedBy === "user" || o.interruptedBy === "disconnect")
      ? { interruptedBy: o.interruptedBy }
      : {}),
  };
}

/** The ui-core outcome of a chat turn, for `buildTurnTranscript`; `undefined` for a plain success. */
export function chatTurnOutcome(turn: {
  readonly content: string;
  readonly runFailed?: TurnRunEnding;
  readonly deliverables?: readonly TurnDeliverable[];
}): TurnOutcome | undefined {
  const r = turn.runFailed;
  const deliverables = turn.deliverables && turn.deliverables.length > 0 ? { deliverables: turn.deliverables } : {};
  if (!r) return turn.deliverables?.length ? { ending: "succeeded", ...deliverables } : undefined;
  const ending = r.ending ?? "failed";
  const split = ending === "partial" ? splitUnfinished(turn.content) : undefined;
  const unfinished = r.unfinished ?? split?.unfinished;
  return {
    ending,
    ...(r.terminatedBy ? { terminatedBy: r.terminatedBy } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.abstention ? { abstention: r.abstention } : {}),
    ...(split ? { draft: split.draft } : {}),
    ...(unfinished && unfinished.length > 0 ? { unfinished } : {}),
    ...(r.interruptedBy ? { interruptedBy: r.interruptedBy } : {}),
    ...deliverables,
  };
}

/** Tone of an ending: a crash is an error, a partial run is a warning, an abstention and files are quiet. */
export type EndingTone = "error" | "warn" | "quiet";

/** The header badge of a turn whose run did not succeed. */
export function endingBadge(r: TurnRunEnding): { readonly label: string; readonly title: string; readonly tone: EndingTone } {
  const how = r.terminatedBy && r.terminatedBy !== "abstained" ? ` (${r.terminatedBy})` : "";
  switch (r.ending) {
    case "abstained":
      return { label: "abstained", tone: "quiet", title: "The agent declined to answer; the reason is below. Open the trace for detail." };
    case "partial":
      return { label: "partial", tone: "warn", title: `The run stopped${how} with a draft and unfinished items, listed below.` };
    case "interrupted":
      return r.interruptedBy === "user"
        ? { label: "stopped", tone: "quiet", title: "You stopped this reply before it finished. Retry runs it again." }
        : { label: "interrupted", tone: "warn", title: "The reply was cut off before it finished; the cause is below. Retry runs it again." };
    default:
      return { label: "did not finish", tone: "error", title: `The run did not finish${how}; no answer was given. The cause is below; open the trace for detail.` };
  }
}

/** The closing note of a turn or run: heading, one cause line and a list. `undefined` for a plain success. */
export interface EndingNote {
  readonly kind: "failed" | "partial" | "abstained" | "interrupted" | "files";
  readonly tone: EndingTone;
  readonly icon: string;
  readonly heading: string;
  /** The cause (failed, partial) or the reason (abstained), one display line. */
  readonly line?: string;
  /** Unfinished items (partial), missing inputs (abstained) or produced files. */
  readonly items: readonly string[];
}

/** Display model for an outcome's closing note. */
export function endingNote(o: TurnOutcome): EndingNote | undefined {
  const files = (o.deliverables ?? []).filter((d) => d.produced).map((d) => d.spec);
  switch (o.ending) {
    case "abstained": {
      const line = runErrorLine(o.abstention?.reason ?? o.error);
      return {
        kind: "abstained",
        tone: "quiet",
        icon: "do_not_disturb_on",
        heading: "The agent abstained",
        ...(line ? { line } : {}),
        items: (o.abstention?.missing ?? []).map((m) => `missing: ${m}`),
      };
    }
    case "partial": {
      const line = o.unfinished && o.unfinished.length > 0 ? undefined : runErrorLine(o.error);
      return { kind: "partial", tone: "warn", icon: "pending", heading: "Unfinished", ...(line ? { line } : {}), items: o.unfinished ?? [] };
    }
    case "failed": {
      const line = runErrorLine(o.error);
      return { kind: "failed", tone: "error", icon: "error", heading: "Run error", ...(line ? { line } : {}), items: [] };
    }
    case "interrupted": {
      const line = runErrorLine(o.error);
      return {
        kind: "interrupted",
        tone: o.interruptedBy === "user" ? "quiet" : "warn",
        icon: o.interruptedBy === "user" ? "stop_circle" : "link_off",
        heading: o.interruptedBy === "user" ? "Stopped" : "Interrupted",
        ...(line ? { line } : {}),
        items: [],
      };
    }
    case "succeeded":
      return files.length > 0 ? { kind: "files", tone: "quiet", icon: "description", heading: "Produced", items: files } : undefined;
    default:
      return undefined;
  }
}

/**
 * How a desk run ended, from its `AgentCompleted` payload (`success`, `error`,
 * `outcome.status`, `outcome.outstanding`, `output`). `undefined` until the run
 * completes or when it succeeded.
 */
export function runEnding(events: readonly { readonly type: string; readonly payload: Readonly<Record<string, unknown>> }[]): TurnOutcome | undefined {
  const done = events.findLast((e) => e.type === "AgentCompleted");
  if (!done) return undefined;
  const o = turnOutcomeOf(done.payload);
  return o.ending === "succeeded" ? undefined : o;
}
