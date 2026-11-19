/**
 * The to-do list's outcome at the end of a run, read for display. The framework reconciles the
 * agent's own to-do rows from recorded evidence when a run ends: a row a successful tool call (or
 * the accepted answer) evidences is closed by the harness, with provenance; a row nothing
 * evidences stays open and is listed as unresolved. The record rides
 * `result.metadata.extensions.checklist` and, for unresolved rows, one `checklist-unresolved`
 * guard event (outcome `warn`: informational, never an error).
 *
 * Pure and dependency-free. Every reader is defensive: an absent or malformed record reads as
 * `undefined`, and an unknown provenance or reason value degrades to a generic label instead of
 * failing.
 */

/** Guard name of the trace record that lists rows which ended with no evidence. */
export const CHECKLIST_UNRESOLVED_GUARD = "checklist-unresolved";

/**
 * Who closed a row when the model did not. `evidence` = a successful tool call or ledger
 * evidence; `answer` = the accepted final answer delivered it; `other` = a provenance this
 * version does not know.
 */
export type ChecklistClosureKind = "evidence" | "answer" | "other";

/** A row the harness closed from recorded evidence. */
export interface ChecklistClosure {
  readonly id: string;
  readonly title: string;
  readonly kind: ChecklistClosureKind;
  /** The raw provenance string as recorded (`harness:evidence`), kept for tooltips and debugging. */
  readonly provenance: string;
  /** Short words for the row: where its done-ness came from. */
  readonly label: string;
  /** The evidence call, when the run recorded one. */
  readonly toolCallId?: string;
}

/** A row that ended open with nothing recording its completion. */
export interface ChecklistUnresolvedRow {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "in_progress";
  /** The framework's reason as recorded (`no evidence`). */
  readonly reason: string;
  /** The reason in words. */
  readonly reasonLabel: string;
}

/** The display model of a run's to-do outcome. */
export interface ChecklistReconciliationView {
  readonly total: number;
  readonly done: number;
  /** `3/5`. */
  readonly label: string;
  readonly closed: readonly ChecklistClosure[];
  readonly unresolved: readonly ChecklistUnresolvedRow[];
}

/** Rows kept per list when a view is stored with a turn. */
export const CHECKLIST_ROWS_STORED = 50;

const record = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : undefined;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined);

const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

/** Where a closure came from, in words. Unknown provenance values read as a generic closure. */
export function closureKindOf(provenance: string): ChecklistClosureKind {
  if (provenance === "harness:evidence") return "evidence";
  if (provenance === "harness:answer") return "answer";
  return "other";
}

const CLOSURE_LABELS: Readonly<Record<ChecklistClosureKind, string>> = {
  evidence: "closed by the harness from a tool result",
  answer: "closed by the harness: the answer delivered it",
  other: "closed by the harness",
};

/** The words for a closure kind. */
export const closureLabel = (kind: ChecklistClosureKind): string => CLOSURE_LABELS[kind];

/** The words for an unresolved row's recorded reason; an unknown reason is shown as recorded. */
export function unresolvedReasonLabel(reason: string): string {
  return reason === "no evidence" ? "no evidence recorded" : reason;
}

const closureOf = (raw: unknown): ChecklistClosure | undefined => {
  const r = record(raw);
  const id = str(r?.["id"]);
  const provenance = str(r?.["provenance"]);
  if (r === undefined || id === undefined || provenance === undefined) return undefined;
  const kind = closureKindOf(provenance);
  const toolCallId = str(r["toolCallId"]);
  return { id, title: str(r["title"]) ?? id, kind, provenance, label: closureLabel(kind), ...(toolCallId !== undefined ? { toolCallId } : {}) };
};

const unresolvedOf = (raw: unknown): ChecklistUnresolvedRow | undefined => {
  const r = record(raw);
  const id = str(r?.["id"]);
  if (r === undefined || id === undefined) return undefined;
  const reason = str(r["reason"]) ?? "no evidence";
  return {
    id,
    title: str(r["title"]) ?? id,
    status: r["status"] === "in_progress" ? "in_progress" : "pending",
    reason,
    reasonLabel: unresolvedReasonLabel(reason),
  };
};

const list = <T>(raw: unknown, read: (v: unknown) => T | undefined): readonly T[] =>
  Array.isArray(raw) ? raw.flatMap((v): T[] => { const x = read(v); return x === undefined ? [] : [x]; }).slice(0, CHECKLIST_ROWS_STORED) : [];

/**
 * The view of a reconciliation record (`metadata.extensions.checklist`, or the metadata of the
 * `checklist-unresolved` guard). `undefined` when the record is absent or has no counts.
 */
export function checklistReconciliationOf(raw: unknown): ChecklistReconciliationView | undefined {
  const r = record(raw);
  const unresolved = list(r?.["unresolved"], unresolvedOf);
  const total = count(r?.["total"]);
  const done = count(r?.["done"]);
  if (r === undefined || total === undefined || done === undefined) return undefined;
  // `closedByHarness` is the framework's key; `closed` is this view's own (a view read back from storage).
  return { total, done, label: `${done}/${total}`, closed: list(r["closedByHarness"] ?? r["closed"], closureOf), unresolved };
}

/** The view from a finished run's result (`StreamCompleted`, `AgentResult`, `AgentCompleted`): reads `metadata.extensions.checklist`. */
export function checklistFromCompletion(completion: { readonly metadata?: unknown }): ChecklistReconciliationView | undefined {
  return checklistReconciliationOf(record(record(record(completion.metadata)?.["extensions"]))?.["checklist"]);
}

/** One quiet line for the guard's note: `2 of 5 to-do rows ended with no evidence`. */
export function checklistUnresolvedLine(view: ChecklistReconciliationView): string {
  const n = view.unresolved.length;
  return `${n} of ${view.total} to-do row${view.total === 1 ? "" : "s"} ended with no evidence`;
}

/**
 * The unresolved list a `checklist-unresolved` guard event announces (a `GuardFiredEmitted`
 * payload, or the trace's `guard-fired` record: `guard` plus `metadata`). `undefined` for any other
 * guard, or when the guard carried no readable rows.
 */
export function checklistUnresolvedOfGuard(guard: { readonly guard?: unknown; readonly metadata?: unknown }): ChecklistReconciliationView | undefined {
  if (guard.guard !== CHECKLIST_UNRESOLVED_GUARD) return undefined;
  const view = checklistReconciliationOf(guard.metadata);
  return view !== undefined && view.unresolved.length > 0 ? view : undefined;
}

/** Closures keyed by row id, to annotate the rows of a to-do list. */
export function closuresById(view: ChecklistReconciliationView | undefined): Readonly<Record<string, ChecklistClosure>> {
  const out: Record<string, ChecklistClosure> = {};
  for (const c of view?.closed ?? []) out[c.id] = c;
  return out;
}

/** Unresolved rows keyed by row id. */
export function unresolvedById(view: ChecklistReconciliationView | undefined): Readonly<Record<string, ChecklistUnresolvedRow>> {
  const out: Record<string, ChecklistUnresolvedRow> = {};
  for (const u of view?.unresolved ?? []) out[u.id] = u;
  return out;
}
