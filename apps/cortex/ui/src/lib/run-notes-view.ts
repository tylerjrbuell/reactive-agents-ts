/**
 * The quiet notes under a finished turn or run (chat transcript and Run view): the to-do outcome
 * (counts, rows the harness closed with where their done-ness came from, rows that ended with no
 * evidence), an answer written from tool results the model had not read, and a finish the strategy
 * accepted. All are informational: muted, never red. The reading rules are ui-core's
 * (`run-notes.ts`, `checklist-reconciliation.ts`); this module only shapes them for the views and
 * folds a desk run's events into the same notes a chat turn stores.
 */
import {
  CHECKLIST_UNRESOLVED_GUARD,
  checklistUnresolvedLine,
  checklistUnresolvedOfGuard,
  runNotesOf,
  runNotesWorthShowing,
  terminalAuthorityView,
  type ChecklistReconciliationView,
  type RunNotes,
} from "@reactive-agents/ui-core";

/** One row of the to-do outcome list. */
export interface RunNotesRow {
  readonly id: string;
  readonly title: string;
  /** Muted words after the title: where done-ness came from, or why the row stayed open. */
  readonly note: string;
}

/** What `RunNotes.svelte` renders. A section is absent when the run reported nothing for it. */
export interface RunNotesView {
  /** A finish the strategy accepted after a capped pass: heading and one sentence. */
  readonly accepted?: { readonly heading: string; readonly text: string };
  /** The answer was written from tool results the model had not read. */
  readonly unread?: { readonly text: string; readonly tools: readonly string[] };
  readonly checklist?: {
    /** `To-do 3/5`. */
    readonly summary: string;
    /** Rows the harness closed from evidence, with provenance. */
    readonly closed: readonly RunNotesRow[];
    /** The unresolved list's heading line, or `undefined` when every row is done. */
    readonly unresolvedLine?: string;
    readonly unresolved: readonly RunNotesRow[];
  };
}

/**
 * The view of a run's notes, or `undefined` when there is nothing worth a line (every row done with
 * no harness closure, a plain authority, no unread note).
 */
export function runNotesView(notes: RunNotes | undefined): RunNotesView | undefined {
  if (!runNotesWorthShowing(notes) || notes === undefined) return undefined;
  const authority = terminalAuthorityView(notes.authority);
  const c = notes.checklist;
  const checklist = c !== undefined && (c.closed.length > 0 || c.unresolved.length > 0) ? checklistSection(c) : undefined;
  return {
    ...(authority?.tone === "accepted" && authority.text !== undefined ? { accepted: { heading: authority.label, text: authority.text } } : {}),
    ...(notes.unread !== undefined ? { unread: { text: notes.unread.text, tools: notes.unread.tools } } : {}),
    ...(checklist !== undefined ? { checklist } : {}),
  };
}

function checklistSection(c: ChecklistReconciliationView): NonNullable<RunNotesView["checklist"]> {
  return {
    summary: `To-do ${c.label}`,
    closed: c.closed.map((r) => ({ id: r.id, title: r.title, note: r.label })),
    ...(c.unresolved.length > 0 ? { unresolvedLine: checklistUnresolvedLine(c) } : {}),
    unresolved: c.unresolved.map((r) => ({ id: r.id, title: r.title, note: r.reasonLabel })),
  };
}

/**
 * The feed title of a `checklist-unresolved` guard record (a trace `guard-fired` row): one quiet
 * line naming how many to-do rows ended with no evidence. `undefined` for any other guard, so the
 * caller keeps its own title. Informational: the guard's outcome is `warn`, which is no error.
 */
export function checklistGuardTitle(trace: { readonly guard?: string; readonly reason?: string; readonly metadata?: unknown }): string | undefined {
  const view = checklistUnresolvedOfGuard(trace);
  if (view !== undefined) return checklistUnresolvedLine(view);
  return trace.guard === CHECKLIST_UNRESOLVED_GUARD && typeof trace.reason === "string" && trace.reason !== "" ? trace.reason : undefined;
}

/** A run event as the Run view holds it. */
interface RunEventLike {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The notes of a desk run, from its events: the last `AgentCompleted` (outcome authority, any
 * checklist or receipt it carries) and the `checklist-unresolved` guard event, which lists the rows
 * that ended with no evidence even when the completion does not carry the reconciliation.
 */
export function runNotesFromRunEvents(events: readonly RunEventLike[]): RunNotes | undefined {
  const done = events.findLast((e) => e.type === "AgentCompleted");
  const fromDone = done !== undefined ? runNotesOf(done.payload) : undefined;
  if (fromDone?.checklist !== undefined) return fromDone;
  const guard = events.findLast((e) => e.type === "GuardFiredEmitted" && checklistUnresolvedOfGuard(e.payload) !== undefined);
  const unresolved = guard !== undefined ? checklistUnresolvedOfGuard(guard.payload) : undefined;
  if (unresolved === undefined) return fromDone;
  return { ...(fromDone ?? {}), checklist: unresolved };
}
