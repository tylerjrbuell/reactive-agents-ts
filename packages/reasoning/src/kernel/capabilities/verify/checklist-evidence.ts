/**
 * verify/checklist-evidence.ts — the harness reconciles the advisory todo list
 * from recorded evidence, so no run ends with rows silently left open.
 *
 * The model owns WRITING the list; the harness owns keeping it honest. Three
 * deterministic rules, all read off the run ledger (no LLM, no prompt text):
 *
 *  1. {@link evidenceTicks} (every turn and at the terminal): a successful tool
 *     call ticks the earliest open row whose tool hint names that tool
 *     ({@link toolHintMatches}; the `in_progress` row first). One call ticks one
 *     row. A row the model settled in the same round as the call keeps the call.
 *  2. At the terminal ({@link reconcileChecklistAtTerminal}): rows the shared
 *     checklist inference (`inferChecklistProgress`, core) anchors to ledger
 *     evidence (an artifact path, a distinctive argument, a satisfied
 *     requirement) are closed, and hint-less "compile / summarize / write the
 *     report" rows ({@link isAnswerRow}) are closed by the ACCEPTED answer (the
 *     `answer` requirement satisfied by the terminal gate).
 *  3. Every row still open after that is reported unresolved, reason
 *     "no evidence" ({@link checklistReconciliation}). It is never ticked.
 *
 * Every harness tick is an ordinary `checklist-item` status fact carrying
 * `provenance` (and the evidence call's `toolCallId`), so the op history says
 * who closed the row and why. Plan rows (`origin: "plan"`) are the plan
 * state's to track and are left alone; sub-agent rows belong to the child.
 *
 * Why the old path left rows open (Cortex traces 01M7T7ESGHR5*, 01M7T73E1AK9*):
 * the model hinted `functions.umami_list_websites` while the tool ran as
 * `umami/list_websites`, and the harness auto-ticked seeded plans only.
 */
import { foldAdvisory, inferChecklistProgress, type AdvisoryItem, type ChecklistFact, type ChecklistInputFact } from "@reactive-agents/core";
import { tokenizeToolName } from "@reactive-agents/tools";
import { recordChecklistItems, type ChecklistItemFact } from "../../ledger/emit.js";
import type { ChecklistItemEntry, ChecklistProvenance, LedgerEntry, RunLedger } from "../../ledger/run-ledger.js";

/** Provenance prefix of facts merged up from a child run (same rule as checklist-round.ts). */
const CHILD_PASS_PREFIX = "sub-agent:";
/** The provider namespace a model copies from an OpenAI-style tool list (`functions.<name>`). */
const FC_NAMESPACE = "functions";
const ANSWER_REQUIREMENT_ID = "answer";

const isOwn = (e: LedgerEntry): boolean => !(e.pass ?? "").startsWith(CHILD_PASS_PREFIX);
const keyOf = (tokens: readonly string[]): string => tokens.join("-");

/**
 * True when a row's tool hint names `toolName`: equal after the framework's
 * one tool-name tokenizer (separators and case collapse, camelCase splits),
 * with the provider's `functions.` namespace dropped from the hint.
 * `functions.umami_list_websites` names `umami/list_websites`; `websearch`
 * does not name `web-search`. Pure.
 */
export function toolHintMatches(hint: string, toolName: string): boolean {
  const target = keyOf(tokenizeToolName(toolName));
  const tokens = tokenizeToolName(hint);
  if (tokens.length === 0 || target.length === 0) return false;
  if (keyOf(tokens) === target) return true;
  return tokens[0] === FC_NAMESPACE && tokens.length > 1 && keyOf(tokens.slice(1)) === target;
}

/** One row the harness closes, and why. */
export interface ChecklistTick {
  readonly id: string;
  readonly title: string;
  readonly provenance: ChecklistProvenance;
  /** The evidence call (rule 1). */
  readonly toolCallId?: string;
}

type ToolResult = Extract<LedgerEntry, { kind: "tool-result" }>;
const isEvidence = (e: LedgerEntry): e is ToolResult & { readonly toolName: string } =>
  e.kind === "tool-result" &&
  e.success &&
  e.harnessAuthored !== true &&
  e.refused !== true &&
  typeof e.toolName === "string" &&
  e.toolName !== "todo";

/** The row a successful call of `toolName` ticks: the in_progress row first, else the first open row in list order. */
function rowFor(items: readonly AdvisoryItem[], claimed: ReadonlyMap<string, ChecklistTick>, toolName: string): AdvisoryItem | undefined {
  const open = items.filter(
    (i) => i.origin !== "plan" && i.status !== "completed" && !claimed.has(i.id) && i.tool !== undefined && toolHintMatches(i.tool, toolName),
  );
  return open.find((i) => i.status === "in_progress") ?? open[0];
}

/**
 * Rule 1: the rows recorded tool evidence completes that no status fact has
 * settled yet. Replays the own-run ledger round by round (a round = a run of
 * entries with one iteration label): list edits first, then the round's tool
 * results, then its status marks, so a row the model marked in the same round
 * as the call keeps that call. A later status fact on a row (the harness tick
 * itself, or the model's own mark either way) settles it. Idempotent. Pure.
 */
export function evidenceTicks(ledger: RunLedger | undefined): readonly ChecklistTick[] {
  const entries = (ledger ?? []).filter(isOwn);
  const facts: ChecklistItemEntry[] = [];
  const claimed = new Map<string, ChecklistTick>();
  let items: readonly AdvisoryItem[] = [];
  for (let start = 0; start < entries.length; ) {
    let end = start;
    while (end < entries.length && entries[end]!.iteration === entries[start]!.iteration) end++;
    const round = entries.slice(start, end);
    start = end;
    const ops = round.filter((e): e is ChecklistItemEntry => e.kind === "checklist-item");
    for (const e of ops) {
      if (e.change.op === "status") continue;
      facts.push(e);
      if (e.change.op === "remove") for (const id of e.change.ids) claimed.delete(id);
    }
    items = foldAdvisory(facts);
    for (const e of round) {
      if (!isEvidence(e)) continue;
      const row = rowFor(items, claimed, e.toolName);
      if (row === undefined) continue;
      claimed.set(row.id, {
        id: row.id,
        title: row.title,
        provenance: "harness:evidence",
        ...(e.toolCallId !== undefined ? { toolCallId: e.toolCallId } : {}),
      });
    }
    for (const e of ops) {
      if (e.change.op !== "status") continue;
      facts.push(e);
      claimed.delete(e.change.id);
    }
    items = foldAdvisory(facts);
  }
  const order = new Map(items.map((i, n) => [i.id, n]));
  return [...claimed.values()]
    .filter((t) => order.has(t.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The status facts that record `ticks` (one `completed` per row, with provenance). */
export function tickFacts(ticks: readonly ChecklistTick[], iteration: number): readonly ChecklistItemFact[] {
  return ticks.map((t) => ({
    iteration,
    change: { op: "status" as const, id: t.id, status: "completed" as const },
    provenance: t.provenance,
    ...(t.toolCallId !== undefined ? { toolCallId: t.toolCallId } : {}),
  }));
}

/** Verbs of a row the final answer itself delivers. */
const ANSWER_VERBS: ReadonlySet<string> = new Set([
  "answer", "compile", "compose", "conclude", "deliver", "draft", "explain", "finalise", "finalize", "format",
  "give", "outline", "present", "prepare", "produce", "provide", "recommend", "reply", "report", "respond",
  "summarise", "summarize", "synthesise", "synthesize", "write",
]);
/** Ordinal / connective words before the verb ("Step 6: compile ...", "Finally, summarize ..."). */
const LEAD_FILLER: ReadonlySet<string> = new Set(["and", "finally", "lastly", "now", "step", "then"]);
/** A row about a side effect the answer text cannot deliver. */
const SIDE_EFFECT_WORDS: ReadonlySet<string> = new Set([
  "commit", "deploy", "disk", "email", "file", "post", "publish", "push", "save", "send", "upload",
]);
const FILE_TARGET = /[\w-]\.(md|txt|json|csv|tsv|html?|pdf|ya?ml|xml|ts|js|py|png|jpe?g|svg|docx?|xlsx?)\b|\//i;

/**
 * True when the accepted final answer itself delivers the row: its first verb
 * (after "step 6:", "finally" ...) is a synthesis verb (compile, summarize,
 * write, report ...) and it names no file target and no side effect (save,
 * send, upload ...). Rows that name a tool are never answer rows: their tool
 * is their evidence. Pure.
 */
export function isAnswerRow(title: string): boolean {
  if (FILE_TARGET.test(title)) return false;
  const words = title.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((w) => SIDE_EFFECT_WORDS.has(w))) return false;
  const lead = words.find((w) => !LEAD_FILLER.has(w));
  return lead !== undefined && ANSWER_VERBS.has(lead);
}

const ownChecklistFacts = (ledger: RunLedger): readonly ChecklistFact[] =>
  ledger.filter(isOwn).flatMap((e): ChecklistFact[] => (e.kind === "checklist-item" || e.kind === "requirement" ? [e] : []));
const ownInputFacts = (ledger: RunLedger): readonly ChecklistInputFact[] =>
  ledger.filter(isOwn).flatMap((e): ChecklistInputFact[] =>
    e.kind === "checklist-item" || e.kind === "requirement" || e.kind === "tool-invocation" || e.kind === "tool-result" || e.kind === "artifact"
      ? [e]
      : [],
  );
const openRows = (items: readonly AdvisoryItem[]): readonly AdvisoryItem[] =>
  items.filter((i) => i.origin !== "plan" && i.status !== "completed");

/** True when the terminal gate accepted a final answer (`answer` requirement satisfied). */
function answerAccepted(ledger: RunLedger): boolean {
  let status: string | undefined;
  for (const e of ledger) if (e.kind === "requirement" && e.requirementId === ANSWER_REQUIREMENT_ID && isOwn(e)) status = e.status;
  return status === "satisfied";
}

/**
 * Rules 1 and 2 at the end of a run: the status facts that close every row the
 * ledger evidences (tool evidence first, then the shared checklist inference,
 * then answer rows when the answer was accepted). Rows with no evidence get no
 * fact. `[]` when nothing closes. Idempotent. Pure.
 */
export function reconcileChecklistAtTerminal(ledger: RunLedger | undefined, iteration: number): readonly ChecklistItemFact[] {
  const base = ledger ?? [];
  const evidence = tickFacts(evidenceTicks(base), iteration);
  const afterEvidence = recordChecklistItems(base, evidence);
  const items = foldAdvisory(ownChecklistFacts(afterEvidence));
  const inferred = inferChecklistProgress(items, ownInputFacts(afterEvidence));
  const inferredFacts = tickFacts(
    openRows(items).filter((i) => inferred.has(i.id)).map((i) => ({ id: i.id, title: i.title, provenance: "harness:evidence" as const })),
    iteration,
  );
  const answerFacts = answerAccepted(base)
    ? tickFacts(
        openRows(items)
          .filter((i) => !inferred.has(i.id) && i.tool === undefined && isAnswerRow(i.title))
          .map((i) => ({ id: i.id, title: i.title, provenance: "harness:answer" as const })),
        iteration,
      )
    : [];
  return [...evidence, ...inferredFacts, ...answerFacts];
}

/** The run's todo outcome, as relayed on `metadata.extensions.checklist`. */
export interface ChecklistReconciliation {
  readonly total: number;
  readonly done: number;
  /** Rows the harness closed from evidence, in list order. */
  readonly closedByHarness: readonly ChecklistTick[];
  /** Rows still open at the end: nothing recorded evidences them. Never ticked. */
  readonly unresolved: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "pending" | "in_progress";
    readonly reason: "no evidence";
  }[];
}

/**
 * The todo outcome of a finished run's ledger (own rows, plan rows excluded),
 * or `undefined` when the run kept no todo list. Pure.
 */
export function checklistReconciliation(ledger: RunLedger | undefined): ChecklistReconciliation | undefined {
  const own = (ledger ?? []).filter(isOwn);
  const rows = foldAdvisory(ownChecklistFacts(own)).filter((i) => i.origin !== "plan");
  if (rows.length === 0) return undefined;
  const closer = new Map<string, ChecklistItemEntry>();
  for (const e of own) {
    if (e.kind !== "checklist-item" || e.change.op !== "status") continue;
    if (e.provenance !== undefined && e.change.status === "completed" && !closer.has(e.change.id)) closer.set(e.change.id, e);
    else if (e.change.status !== "completed") closer.delete(e.change.id);
  }
  const closedByHarness: ChecklistTick[] = rows.flatMap((i) => {
    const e = i.status === "completed" ? closer.get(i.id) : undefined;
    return e?.provenance === undefined
      ? []
      : [{ id: i.id, title: i.title, provenance: e.provenance, ...(e.toolCallId !== undefined ? { toolCallId: e.toolCallId } : {}) }];
  });
  return {
    total: rows.length,
    done: rows.filter((i) => i.status === "completed").length,
    closedByHarness,
    unresolved: rows.flatMap((i) =>
      i.status === "completed" ? [] : [{ id: i.id, title: i.title, status: i.status, reason: "no evidence" as const }],
    ),
  };
}
