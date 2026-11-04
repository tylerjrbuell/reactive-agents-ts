/**
 * planning/plan-checklist.ts — the plan IS the checklist (D9 P7).
 *
 * Shared by every planning strategy (plan-execute, blueprint, and any future
 * planner): a strategy already tracks its plan steps and their status, so this
 * projects that state into advisory `checklist-item` ledger facts (origin
 * `"plan"`) announced live. Consumers (the checklist stream, Cortex) see the
 * plan move from the strategy's own state, with no `todo` call from the model
 * and no per-strategy display logic. Rows stay advisory: requirement rows
 * remain the only completion truth.
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
import { appendAnnounced, ledgerSinkTarget, type LedgerSinkTarget } from "../../kernel/ledger/ledger-sink.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";

/** The plan-step fields a checklist row is projected from (any planner's step shape). */
export type PlanChecklistStep = Pick<PlanStep, "id" | "title" | "status">;

/** What has already been written to the checklist, keyed by step id + title. */
export interface PlanChecklistState {
  readonly rows: ReadonlyMap<string, { readonly rowId: string; readonly status: ChecklistItemStatus }>;
}

/** Nothing written yet. */
export const emptyPlanChecklist: PlanChecklistState = { rows: new Map() };

const rowKey = (s: PlanChecklistStep): string => `${s.id}\u0000${s.title}`;

/** A plan step's checklist status; `undefined` = no change (failed / skipped keep their last row status). */
function rowStatus(s: PlanChecklistStep, active: ReadonlySet<string>): ChecklistItemStatus | undefined {
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
  steps: readonly PlanChecklistStep[],
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

/** A planner's live plan checklist: call `sync` whenever its plan state changes. */
export interface PlanChecklist {
  /**
   * Write the delta between the plan's current state and the checklist, announced
   * live. `active` names steps being dispatched now. No-op when nothing changed.
   */
  readonly sync: (
    steps: readonly PlanChecklistStep[],
    opts?: { readonly active?: readonly string[]; readonly iteration?: number },
  ) => Effect.Effect<void, never>;
}

/** Open a plan checklist on a strategy's run ledger (the same ledger its tool facts grow). */
export const makePlanChecklist = (args: {
  readonly ledger: Ref.Ref<RunLedger>;
  readonly eventBus: StrategyServices["eventBus"];
  readonly taskId: string;
  readonly agentId?: string;
  /** Diagnostic site label for swallowed publish errors. */
  readonly site: string;
}): Effect.Effect<PlanChecklist, never> =>
  Effect.gen(function* () {
    const state = yield* Ref.make(emptyPlanChecklist);
    const target: LedgerSinkTarget = ledgerSinkTarget(args.eventBus, args.taskId, args.agentId, args.site);
    return {
      sync: (steps, opts) =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(state);
          const { state: next, facts } = planChecklistFacts(prev, steps, new Set(opts?.active ?? []), opts?.iteration ?? 0);
          yield* Ref.set(state, next);
          if (facts.length > 0) yield* appendAnnounced(args.ledger, (led) => recordChecklistItems(led, facts), target);
        }),
    };
  });
