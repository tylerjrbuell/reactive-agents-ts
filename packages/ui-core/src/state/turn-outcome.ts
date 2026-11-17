/**
 * How a finished run (or chat turn) ended, read from the framework's own result
 * fields. The harness never writes text into `output`: a failed or abstained run
 * ships `output: ""` with the cause on `error`, a partial run ships the model's
 * draft followed by an `Unfinished:` list, and a run whose answer is a file can
 * succeed with empty output (the deliverables are on `receipt.deliverables`).
 * Apps show the ending from these fields, never by parsing harness sentences.
 *
 * Pure and dependency-free: works on a `StreamCompleted` event, an `AgentResult`,
 * or an `AgentCompleted` bus payload.
 */

/**
 * How a turn ended.
 * - `succeeded`: the run reported success. The answer is `output`; when that is
 *   empty, the deliverables are the answer.
 * - `partial`: the run stopped with a model draft and named what was left
 *   unfinished.
 * - `failed`: the run did not complete; `error` is the cause.
 * - `abstained`: the agent declined to answer (no grounded answer, a required
 *   tool missing). Not a crash: show the reason, not an error.
 * - `paused`: a durable run is waiting on an approval or a user answer.
 * - `interrupted`: the turn was stopped before its run completed (the user
 *   stopped it, or the client's connection closed). Stored, so a reloaded
 *   transcript can say why the reply is missing.
 * - `cancelled` / `errored`: the live stream was stopped or broke before completing.
 */
export type TurnEnding =
  | "succeeded"
  | "partial"
  | "failed"
  | "abstained"
  | "paused"
  | "interrupted"
  | "cancelled"
  | "errored";

/** Who stopped an interrupted turn: the user (Stop), or the client's connection closing. */
export type InterruptedBy = "user" | "disconnect";

/**
 * Which button a user pressed: `"pause"` (Pause) or `"stop"` (Stop). A
 * {@link TurnOutcome} sets it only for a pause, so an unmarked user stop reads
 * as a stop.
 */
export type UserInterrupt = "pause" | "stop";

/** A declared deliverable and whether the run produced it (`receipt.deliverables`). */
export interface TurnDeliverable {
  readonly spec: string;
  readonly produced: boolean;
}

/** The detail behind a completed turn's ending. */
export interface TurnOutcome {
  readonly ending: Exclude<TurnEnding, "cancelled" | "errored">;
  /** The run's cause (`error`): set on failed, partial and abstained runs when reported. */
  readonly error?: string;
  /** How the loop ended (`terminatedBy`), when reported. */
  readonly terminatedBy?: string;
  /** Abstained runs: why the agent declined, and what it was missing. */
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  /** Partial runs: the model's draft, without the `Unfinished:` list. */
  readonly draft?: string;
  /** Partial runs: the items left unfinished. */
  readonly unfinished?: readonly string[];
  /** Declared deliverables from the receipt, when the run declared any. */
  readonly deliverables?: readonly TurnDeliverable[];
  /** Interrupted turns, and a partial the user stopped (`"user"`): who stopped it, when known. */
  readonly interruptedBy?: InterruptedBy;
  /** `"pause"` when the user's stop was a Pause (a `user-paused` record, or a stream cancelled as `user-paused`); absent for a Stop. */
  readonly userInterrupt?: UserInterrupt;
}

/**
 * The fields {@link turnOutcomeOf} reads. Every field is optional and loosely
 * typed so a `StreamCompleted`, an `AgentResult` or an `AgentCompleted` payload
 * can be passed as is.
 */
export interface RunCompletionLike {
  readonly success?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly terminatedBy?: unknown;
  readonly abstention?: unknown;
  readonly receipt?: unknown;
  /** `AgentCompleted.outcome` (the reconciled terminal outcome). */
  readonly outcome?: unknown;
  /** `StreamCompleted.status` / `AgentResult.status` on a paused durable run. */
  readonly status?: unknown;
  readonly pendingApproval?: unknown;
  readonly pendingInteraction?: unknown;
  readonly metadata?: unknown;
  /** `AgentResult.stop` (the durable run's stop record): its `kind` marks a user stop or pause. */
  readonly stop?: unknown;
  /** `AgentResult.loopStop`: the same stop record on results that carry it there. */
  readonly loopStop?: unknown;
  /**
   * Set when the turn never completed: `"user"` (stopped), `"disconnect"` (the
   * client went away), `"user-paused"` (the user paused it) or `true` (unknown).
   * A `StreamCancelled.reason` can be passed as is. Absent or `false` on a run that completed.
   */
  readonly interrupted?: unknown;
}

/** The outstanding criterion the framework leaves on a run the user stopped (`stopped_by_request`). */
export const USER_STOP_CRITERION = "stopped_by_request";

/**
 * Whether a stop record's `kind` is one a person asked for: `user-stopped` or
 * `user-paused`. Every other kind (`loop`, `budget`, `error`, ...) is a failure
 * or a guard, not the user's choice.
 */
export function isUserStopKind(kind: unknown): kind is "user-stopped" | "user-paused" {
  return kind === "user-stopped" || kind === "user-paused";
}

/**
 * `"pause"` when a stop record's `kind` is `user-paused`, else `undefined` (a
 * `user-stopped` kind and every non-user kind read as no marker).
 */
export function userInterruptOf(stop: unknown): UserInterrupt | undefined {
  return record(stop)?.["kind"] === "user-paused" ? "pause" : undefined;
}

/**
 * Whether a finished result is a run the user stopped or paused. The framework
 * ships that as an honest partial: `success: false`, `stopped_by_request`
 * outstanding (on `outcome.outstanding`, `metadata.outstandingCriteria` or the
 * `Unfinished:` list), and a stop record whose kind is `user-stopped` /
 * `user-paused`. Any one of those marks it. `success` must be `false`: a run
 * that finished its work while the stop was in flight is a success.
 */
export function isUserStopResult(c: RunCompletionLike): boolean {
  if (c.success !== false) return false;
  if (isUserStopKind(record(c.stop)?.["kind"]) || isUserStopKind(record(c.loopStop)?.["kind"])) return true;
  const outcome = record(c.outcome);
  if (strings(outcome?.["outstanding"]).includes(USER_STOP_CRITERION)) return true;
  if (strings(record(c.metadata)?.["outstandingCriteria"]).includes(USER_STOP_CRITERION)) return true;
  const split = typeof c.output === "string" ? splitUnfinished(c.output) : undefined;
  return split?.unfinished.includes(USER_STOP_CRITERION) ?? false;
}

/**
 * The cause line of an interrupted turn, for apps that store or show one.
 * `undefined` reads as "stopped before it finished" without naming who.
 */
export function interruptionCause(by: InterruptedBy | undefined, how?: UserInterrupt): string {
  switch (by) {
    case "user":
      if (how === "pause") return "You paused this reply before it finished.";
      return "You stopped this reply before it finished.";
    case "disconnect":
      return "The connection closed before the reply finished (the page was closed or left), so the run was stopped.";
    default:
      return "The reply was stopped before it finished.";
  }
}

/**
 * One display line for an error cause: the first non-blank line of the text
 * (or of an `Error`'s message) without the error class tags a thrown tagged
 * error carries (`LLMError: `, `Error: FiberFailure: `). `undefined` when there
 * is no text. Pure.
 */
export function causeLineOf(raw: unknown): string | undefined {
  const text = typeof raw === "string" ? raw : messageOf(raw);
  const line = text?.split("\n").find((l) => l.trim() !== "")?.trim();
  if (line === undefined) return undefined;
  const stripped = line.replace(ERROR_TAGS, "").trim();
  return stripped.length > 0 ? stripped : line;
}

/** The `message` of an `Error` (or any object carrying one), read without `instanceof`. */
const messageOf = (v: unknown): string | undefined =>
  v !== null && typeof v === "object" && "message" in v && typeof v.message === "string" ? v.message : undefined;

/** Leading class tags (`Error: `, `LLMError: `, `FiberFailure: `), repeated. */
const ERROR_TAGS = /^(?:(?:[A-Z][A-Za-z0-9]*Error|Error|FiberFailure)(?: \[[^\]]*\])?:\s*)+/;

/** The kernel's partial-run header (`Unfinished:` on its own line, then `- item` lines). */
const UNFINISHED = /(?:^|\n)[ \t]*Unfinished:[ \t]*\n((?:[ \t]*[-*][^\n]*(?:\n|$))+)/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined);

const record = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : undefined;

const strings = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

/**
 * Split a partial run's output into the model's draft and the `Unfinished:`
 * items. `undefined` when the text has no `Unfinished:` list.
 */
export function splitUnfinished(output: string): { readonly draft: string; readonly unfinished: readonly string[] } | undefined {
  const m = UNFINISHED.exec(output);
  if (!m) return undefined;
  const unfinished = m[1]!
    .split("\n")
    .map((l) => l.replace(/^[ \t]*[-*][ \t]*/, "").trim())
    .filter((l) => l.length > 0);
  if (unfinished.length === 0) return undefined;
  return { draft: output.slice(0, m.index).trim(), unfinished };
}

const deliverablesOf = (receipt: unknown): readonly TurnDeliverable[] => {
  const list = record(receipt)?.["deliverables"];
  if (!Array.isArray(list)) return [];
  return list.flatMap((d): TurnDeliverable[] => {
    const r = record(d);
    const spec = str(r?.["spec"]);
    return spec !== undefined && typeof r?.["produced"] === "boolean" ? [{ spec, produced: r["produced"] }] : [];
  });
};

const abstentionOf = (v: unknown): TurnOutcome["abstention"] | undefined => {
  const r = record(v);
  const reason = str(r?.["reason"]);
  if (reason === undefined) return undefined;
  const missing = strings(r?.["missing"]);
  return { reason, ...(missing.length > 0 ? { missing } : {}) };
};

/**
 * Classify a finished run from the framework's result fields.
 *
 * - Interrupted: `interrupted` is set (the turn never completed). The cause is
 *   `error`, else {@link interruptionCause}.
 * - Paused: `status` is `awaiting-approval` / `awaiting-interaction`, or a pending
 *   approval / interaction is attached.
 * - Abstained: `terminatedBy: "abstained"`, an `abstention` object, or
 *   `outcome.status: "abstained"`. The reason is `abstention.reason`, else `error`.
 * - Succeeded: `success` is not `false`.
 * - Stopped by the user: `success: false` and {@link isUserStopResult}: ending
 *   `partial` with `interruptedBy: "user"`, the answer so far as `draft`, no `error`.
 * - Partial: `success: false` and the output holds a draft plus an `Unfinished:`
 *   list, or `outcome.status: "partial"` (items then come from
 *   `outcome.outstanding` / `metadata.outstandingCriteria`).
 * - Failed: any other `success: false`.
 *
 * `deliverables` (from `receipt.deliverables`) is attached whatever the ending.
 */
export function turnOutcomeOf(c: RunCompletionLike): TurnOutcome {
  const error = str(c.error);
  const terminatedBy = str(c.terminatedBy);
  const deliverables = deliverablesOf(c.receipt);
  const outcome = record(c.outcome);
  const base = {
    ...(error !== undefined ? { error } : {}),
    ...(terminatedBy !== undefined ? { terminatedBy } : {}),
    ...(deliverables.length > 0 ? { deliverables } : {}),
  };

  if (c.interrupted !== undefined && c.interrupted !== false && c.interrupted !== null) {
    const paused = c.interrupted === "user-paused";
    const by: InterruptedBy | undefined =
      paused || c.interrupted === "user" ? "user" : c.interrupted === "disconnect" ? "disconnect" : undefined;
    const how: UserInterrupt | undefined = paused ? "pause" : undefined;
    return {
      ending: "interrupted",
      ...base,
      error: error ?? interruptionCause(by, how),
      ...(by !== undefined ? { interruptedBy: by } : {}),
      ...(how !== undefined ? { userInterrupt: how } : {}),
    };
  }

  const status = str(c.status);
  if (status === "awaiting-approval" || status === "awaiting-interaction" || c.pendingApproval || c.pendingInteraction) {
    return { ending: "paused", ...base };
  }

  const abstention = abstentionOf(c.abstention);
  if (terminatedBy === "abstained" || abstention !== undefined || outcome?.["status"] === "abstained") {
    const reason = abstention ?? (error !== undefined ? { reason: error } : undefined);
    return { ending: "abstained", ...base, ...(reason !== undefined ? { abstention: reason } : {}) };
  }

  if (c.success !== false) return { ending: "succeeded", ...base };

  const output = typeof c.output === "string" ? c.output : "";
  const split = splitUnfinished(output);
  if (isUserStopResult(c)) {
    // The person's own stop: the answer so far, no cause, nothing to blame.
    const { error: _cause, ...rest } = base;
    const left = (split?.unfinished ?? strings(outcome?.["outstanding"])).filter((x) => x !== USER_STOP_CRITERION);
    const how = userInterruptOf(c.stop) ?? userInterruptOf(c.loopStop);
    return {
      ending: "partial",
      ...rest,
      draft: split?.draft ?? output.trim(),
      interruptedBy: "user",
      ...(how !== undefined ? { userInterrupt: how } : {}),
      ...(left.length > 0 ? { unfinished: left } : {}),
    };
  }
  if (split !== undefined) return { ending: "partial", ...base, draft: split.draft, unfinished: split.unfinished };
  if (outcome?.["status"] === "partial" && output.trim().length > 0) {
    const listed = strings(outcome["outstanding"]);
    const unfinished = listed.length > 0 ? listed : strings(record(c.metadata)?.["outstandingCriteria"]);
    return { ending: "partial", ...base, draft: output.trim(), ...(unfinished.length > 0 ? { unfinished } : {}) };
  }
  return { ending: "failed", ...base };
}
