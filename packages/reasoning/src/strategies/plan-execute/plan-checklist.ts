/**
 * plan-execute/plan-checklist.ts — the plan IS the checklist (D9 P7).
 *
 * plan-execute already tracks its plan steps and their status. This projects
 * that state into advisory `checklist-item` ledger facts (origin `"plan"`), so
 * live consumers (the checklist stream, Cortex) see the plan move with no
 * `todo` call from the model. Rows stay advisory: requirement rows remain the
 * only completion truth.
 *
 * Row identity is (step id, title): a plan patch can reuse a step id for a new
 * step, which gets its own row. A failed or replaced step keeps its last
 * status (the checklist has no cancelled state yet).
 */
import { Effect, Ref } from "effect";
import type { ChecklistItemOp, ChecklistItemStatus } from "@reactive-agents/core";
import type { PlanStep } from "../../types/plan.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { recordChecklistItems, type ChecklistItemFact } from "../../kernel/ledger/emit.js";
import { appendAnnounced, type LedgerSinkTarget } from "../../kernel/ledger/ledger-sink.js";

/** What has already been written to the checklist, keyed by step id + title. */
export interface PlanChecklistState {
  readonly rows: ReadonlyMap<string, { readonly rowId: string; readonly status: ChecklistItemStatus }>;
}

/** Nothing written yet. */
export const emptyPlanChecklist: PlanChecklistState = { rows: new Map() };

const rowKey = (s: Pick<PlanStep, "id" | "title">): string => `${s.id}\u0000${s.title}`;

/** A plan step's checklist status; `undefined` = no change (failed / skipped keep their last row status). */
function rowStatus(s: PlanStep, active: ReadonlySet<string>): ChecklistItemStatus | undefined {
  if (s.status === "completed") return "completed";
  if (s.status === "in_progress" || active.has(s.id)) return "in_progress";
  if (s.status === "pending") return "pending";
  return undefined;
}

/**
 * Pure: the facts that bring the checklist in line with `steps`.
 * `active` names steps being dispatched now (shown in progress before they run).
 */
export function planChecklistFacts(
  state: PlanChecklistState,
  steps: readonly PlanStep[],
  active: ReadonlySet<string>,
  iteration: number,
): { readonly state: PlanChecklistState; readonly facts: readonly ChecklistItemFact[] } {
  const rows = new Map(state.rows);
  const usedIds = new Set([...rows.values()].map((r) => r.rowId));
  const added: { id: string; title: string }[] = [];
  const statusOps: ChecklistItemOp[] = [];
  for (const s of steps) {
    const key = rowKey(s);
    let row = rows.get(key);
    if (row === undefined) {
      let rowId = s.id;
      for (let n = 2; usedIds.has(rowId); n++) rowId = `${s.id}.${n}`;
      usedIds.add(rowId);
      row = { rowId, status: "pending" };
      rows.set(key, row);
      added.push({ id: rowId, title: s.title });
    }
    const next = rowStatus(s, active);
    if (next !== undefined && next !== row.status) {
      rows.set(key, { rowId: row.rowId, status: next });
      statusOps.push({ op: "status", id: row.rowId, status: next });
    }
  }
  const ops: ChecklistItemOp[] = [...(added.length > 0 ? [{ op: "add" as const, items: added }] : []), ...statusOps];
  return { state: { rows }, facts: ops.map((change) => ({ iteration, change, origin: "plan" as const })) };
}

/** Write the plan's checklist delta to the run ledger, announced live. No-op when nothing changed. */
export const syncPlanChecklist = (args: {
  readonly state: Ref.Ref<PlanChecklistState>;
  readonly ledger: Ref.Ref<RunLedger>;
  readonly target: LedgerSinkTarget;
  readonly steps: readonly PlanStep[];
  readonly active?: readonly string[];
  readonly iteration: number;
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const prev = yield* Ref.get(args.state);
    const { state, facts } = planChecklistFacts(prev, args.steps, new Set(args.active ?? []), args.iteration);
    yield* Ref.set(args.state, state);
    if (facts.length > 0) yield* appendAnnounced(args.ledger, (led) => recordChecklistItems(led, facts), args.target);
  });
