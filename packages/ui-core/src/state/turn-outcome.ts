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
 * - `cancelled` / `errored`: the stream was stopped or broke before completing.
 */
export type TurnEnding = "succeeded" | "partial" | "failed" | "abstained" | "paused" | "cancelled" | "errored";

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
}

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
 * - Paused: `status` is `awaiting-approval` / `awaiting-interaction`, or a pending
 *   approval / interaction is attached.
 * - Abstained: `terminatedBy: "abstained"`, an `abstention` object, or
 *   `outcome.status: "abstained"`. The reason is `abstention.reason`, else `error`.
 * - Succeeded: `success` is not `false`.
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
  if (split !== undefined) return { ending: "partial", ...base, draft: split.draft, unfinished: split.unfinished };
  if (outcome?.["status"] === "partial" && output.trim().length > 0) {
    const listed = strings(outcome["outstanding"]);
    const unfinished = listed.length > 0 ? listed : strings(record(c.metadata)?.["outstandingCriteria"]);
    return { ending: "partial", ...base, draft: output.trim(), ...(unfinished.length > 0 ? { unfinished } : {}) };
  }
  return { ending: "failed", ...base };
}
