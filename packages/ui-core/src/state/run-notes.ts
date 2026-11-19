/**
 * Quiet notes about how a run ended, read from the framework's own result metadata: the to-do
 * outcome (`extensions.checklist`), an answer written from tool results the model had not read
 * (`unreadResultsSynthesis` / the `unread-results-synthesis` harness signal), and the authority
 * that decided the run (`strategy-accepted`: the strategy accepted the answer after a capped pass).
 *
 * Every note is informational. None is an error, and an unknown value (a new authority, a new
 * synthesis outcome) degrades to a neutral label instead of failing. Pure and dependency-free; the
 * result is JSON-safe so a server can store it with the turn and read it back with
 * {@link runNotesFromStorage}.
 */
import { checklistFromCompletion, checklistReconciliationOf, type ChecklistReconciliationView } from "./checklist-reconciliation.js";

/** Actor name of the harness signal recorded when a final pass ended with unread tool results. */
export const UNREAD_RESULTS_ACTOR = "unread-results-synthesis";

/** What the unread-results rule did: wrote the answer from the results, kept the draft, or was skipped. */
export type UnreadResultsOutcome = "synthesized" | "draft-kept" | "skipped" | "unknown";

/** The final pass ended with tool results no model turn had read. */
export interface UnreadResultsNote {
  /** How many results were unread (0 when the record did not say). */
  readonly count: number;
  /** The tools whose results were unread. */
  readonly tools: readonly string[];
  readonly outcome: UnreadResultsOutcome;
  /** One display line. */
  readonly text: string;
}

/** How the framework says the run was decided, in words. */
export interface TerminalAuthorityView {
  /** The authority as recorded. */
  readonly authority: string;
  readonly label: string;
  /** `accepted` = a successful finish owned by the strategy's own check; `neutral` = any other authority. */
  readonly tone: "accepted" | "neutral";
  /** A sentence for a note; absent for an authority that needs none. */
  readonly text?: string;
}

/** The authority a strategy records when its own check accepted the answer after a pass hit its limit. */
export const STRATEGY_ACCEPTED_AUTHORITY = "strategy-accepted";

const record = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : undefined;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined);

/**
 * The words for a terminal authority. `strategy-accepted` reads as an accepted finish; every other
 * value (a known one such as `model-final`, `guard:<name>`, or one this version has never seen)
 * reads as a neutral label with no note text.
 */
export function terminalAuthorityView(authority: unknown): TerminalAuthorityView | undefined {
  const a = str(authority);
  if (a === undefined) return undefined;
  if (a === STRATEGY_ACCEPTED_AUTHORITY) {
    return {
      authority: a,
      label: "Accepted by the strategy",
      tone: "accepted",
      text: "The strategy accepted this answer after a pass reached its limit. The run finished.",
    };
  }
  return { authority: a, label: a.replace(/[-_:]+/g, " ").trim(), tone: "neutral" };
}

/** The line for an unread-results note. */
export function unreadResultsText(outcome: UnreadResultsOutcome): string {
  switch (outcome) {
    case "synthesized":
      return "The answer was written from tool results the model had not read.";
    case "draft-kept":
      return "The last tool results were never read; the earlier draft was kept.";
    case "skipped":
      return "The last tool results were never read; the earlier draft was kept because the run budget was spent.";
    default:
      return "The last tool results were not read by the model before the run ended.";
  }
}

const outcomeOf = (v: unknown): UnreadResultsOutcome => (v === "synthesized" || v === "draft-kept" || v === "skipped" ? v : "unknown");

const unreadNote = (count: number, tools: readonly string[], outcome: UnreadResultsOutcome): UnreadResultsNote => ({
  count,
  tools,
  outcome,
  text: unreadResultsText(outcome),
});

const toolsOf = (v: unknown): readonly string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t !== "") : []);

/** The outcome an intervention's `whatChanged` sentence states. */
function outcomeOfSentence(whatChanged: string): UnreadResultsOutcome {
  if (whatChanged.includes("synthesized")) return "synthesized";
  if (whatChanged.includes("skipped")) return "skipped";
  if (whatChanged.includes("returned nothing")) return "draft-kept";
  return "unknown";
}

/** The note from a harness intervention record (`receipt.interventions[]`, or a step's `metadata.intervention`). */
function unreadFromIntervention(raw: unknown): UnreadResultsNote | undefined {
  const r = record(raw);
  if (r === undefined || r["actor"] !== UNREAD_RESULTS_ACTOR) return undefined;
  const evidence = str(r["evidence"]) ?? "";
  const tools = evidence.startsWith("unread:") ? evidence.slice("unread:".length).split(",").map((t) => t.trim()).filter((t) => t !== "") : [];
  return unreadNote(tools.length, tools, outcomeOfSentence(str(r["whatChanged"]) ?? ""));
}

/**
 * The unread-results note of a finished run. Sources, first match wins: the
 * `metadata.unreadResultsSynthesis` record; the harness intervention on `receipt.interventions`;
 * the harness-signal step on `metadata.reasoningSteps`. `undefined` when the rule did not apply.
 */
export function unreadResultsNoteOf(completion: { readonly metadata?: unknown; readonly receipt?: unknown }): UnreadResultsNote | undefined {
  const meta = record(completion.metadata);
  const rec = record(meta?.["unreadResultsSynthesis"]);
  if (rec !== undefined) {
    const tools = toolsOf(rec["tools"]);
    const unread = typeof rec["unread"] === "number" && Number.isFinite(rec["unread"]) ? Math.max(0, Math.floor(rec["unread"])) : tools.length;
    return unreadNote(unread, tools, outcomeOf(rec["outcome"]));
  }
  const interventions = record(completion.receipt)?.["interventions"];
  if (Array.isArray(interventions)) {
    for (const i of interventions) {
      const note = unreadFromIntervention(i);
      if (note !== undefined) return note;
    }
  }
  const steps = meta?.["reasoningSteps"];
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const note = unreadFromIntervention(record(record(s)?.["metadata"])?.["intervention"]);
      if (note !== undefined) return note;
    }
  }
  return undefined;
}

/**
 * The terminal authority of a finished run. Sources, first match wins: an `outcome` object's
 * `authority` (`AgentCompleted.outcome`), a top-level `authority`, then the kernel's own record on
 * `metadata.extensions.terminalOutcome.authority` (what a `StreamCompleted` carries).
 */
export function terminalAuthorityOf(completion: { readonly outcome?: unknown; readonly authority?: unknown; readonly metadata?: unknown }): string | undefined {
  const fromOutcome = str(record(completion.outcome)?.["authority"]);
  if (fromOutcome !== undefined) return fromOutcome;
  const top = str(completion.authority);
  if (top !== undefined) return top;
  return str(record(record(record(completion.metadata)?.["extensions"])?.["terminalOutcome"])?.["authority"]);
}

/** The notes a finished run carries. Every field is absent when the run reported nothing for it. */
export interface RunNotes {
  /** The to-do list's outcome (`extensions.checklist`). */
  readonly checklist?: ChecklistReconciliationView;
  /** The final pass ended with tool results no model turn read. */
  readonly unread?: UnreadResultsNote;
  /** The authority that decided the run. */
  readonly authority?: string;
}

/** What {@link runNotesOf} reads: a `StreamCompleted`, `AgentResult` or `AgentCompleted` payload. */
export interface RunNotesSource {
  readonly metadata?: unknown;
  readonly receipt?: unknown;
  readonly outcome?: unknown;
  readonly authority?: unknown;
}

/** The notes of a finished run, or `undefined` when it reported none of them. */
export function runNotesOf(completion: RunNotesSource): RunNotes | undefined {
  const checklist = checklistFromCompletion(completion);
  const unread = unreadResultsNoteOf(completion);
  const authority = terminalAuthorityOf(completion);
  if (checklist === undefined && unread === undefined && authority === undefined) return undefined;
  return {
    ...(checklist !== undefined ? { checklist } : {}),
    ...(unread !== undefined ? { unread } : {}),
    ...(authority !== undefined ? { authority } : {}),
  };
}

/**
 * Notes read back from JSON a server stored with a turn (additive: an older row has none).
 * Malformed fields are dropped; an unknown authority or outcome is kept as a neutral value.
 */
export function runNotesFromStorage(raw: unknown): RunNotes | undefined {
  const r = record(raw);
  if (r === undefined) return undefined;
  const checklist = checklistReconciliationOf(r["checklist"]);
  const u = record(r["unread"]);
  const unread = u !== undefined ? unreadNote(typeof u["count"] === "number" && u["count"] >= 0 ? Math.floor(u["count"]) : 0, toolsOf(u["tools"]), outcomeOf(u["outcome"])) : undefined;
  const authority = str(r["authority"]);
  if (checklist === undefined && unread === undefined && authority === undefined) return undefined;
  return {
    ...(checklist !== undefined ? { checklist } : {}),
    ...(unread !== undefined ? { unread } : {}),
    ...(authority !== undefined ? { authority } : {}),
  };
}

/**
 * Whether a run's notes are worth a line in the UI. A to-do outcome with every row done and no
 * harness closures, a neutral authority and no unread note say nothing the run's own to-do list does not.
 */
export function runNotesWorthShowing(notes: RunNotes | undefined): boolean {
  if (notes === undefined) return false;
  const c = notes.checklist;
  const checklistSays = c !== undefined && (c.unresolved.length > 0 || c.closed.length > 0);
  return checklistSays || notes.unread !== undefined || terminalAuthorityView(notes.authority)?.tone === "accepted";
}
