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
 * step, which gets its own row. A failed step keeps its last status; a replaced
 * step (gone from the plan) has its row removed unless it completed.
 *
 * The same sync publishes the typed plan events (`PlanRecorded` when the plan
 * first appears or its step set changes, `PlanStepStatusChanged` per status
 * change; see ./plan-events.ts) on the strategy's event bus.
 */
import { Effect, Option, Ref } from "effect";
import { emitErrorSwallowed, errorTag, type ChecklistItemOp, type ChecklistItemStatus } from "@reactive-agents/core";
import { planStepEvents, toCorePlanStatus, type PlanEventSnapshot, type PlanEventSnapshotStep } from "./plan-events.js";
import type { PlanStep } from "../../types/plan.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { recordChecklistItems, type ChecklistItemFact } from "../../kernel/ledger/emit.js";
import { appendAnnounced, ledgerSinkTarget, type LedgerSinkTarget } from "../../kernel/ledger/ledger-sink.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";

/** The plan-step fields a checklist row is projected from (any planner's step shape). */
export type PlanChecklistStep = Pick<PlanStep, "id" | "title" | "status"> &
  Partial<Pick<PlanStep, "toolName" | "toolHints">>;

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
  const added: { id: string; title: string; tool?: string }[] = [];
  const present = new Set(steps.map(rowKey));
  const removed: string[] = [];
  for (const [key, row] of state.rows) {
    if (present.has(key) || row.status === "completed") continue;
    rows.delete(key);
    removed.push(row.rowId);
  }
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
      const tool = s.toolName ?? s.toolHints?.[0];
      added.push({ id: rowId, title: s.title, ...(tool !== undefined && tool.length > 0 ? { tool } : {}) });
    }
    const next = rowStatus(s, active);
    if (next !== undefined && next !== row.status) {
      rows.set(key, { rowId: row.rowId, status: next });
      statusOps.push({ op: "status", id: row.rowId, status: next });
    }
  }
  const ops: ChecklistItemOp[] = [
    ...(removed.length > 0 ? [{ op: "remove" as const, ids: removed }] : []),
    ...(added.length > 0 ? [{ op: "add" as const, items: added }] : []),
    ...statusOps,
  ];
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
    const published = yield* Ref.make<PlanEventSnapshot>(undefined);
    const target: LedgerSinkTarget = ledgerSinkTarget(args.eventBus, args.taskId, args.agentId, args.site);
    return {
      sync: (steps, opts) =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(state);
          const { state: next, facts } = planChecklistFacts(prev, steps, new Set(opts?.active ?? []), opts?.iteration ?? 0);
          yield* Ref.set(state, next);
          if (facts.length > 0) yield* appendAnnounced(args.ledger, (led) => recordChecklistItems(led, facts), target);
          // The same sync also publishes the plan events (PlanRecorded / PlanStepStatusChanged).
          if (Option.isSome(args.eventBus)) {
            const bus = args.eventBus.value;
            const snap: PlanEventSnapshotStep[] = steps.map((s) => {
              const tool = s.toolName ?? s.toolHints?.[0];
              return {
                id: s.id,
                title: s.title,
                ...(tool !== undefined && tool.length > 0 ? { tool } : {}),
                status: toCorePlanStatus(next.rows.get(rowKey(s))?.status ?? "pending"),
              };
            });
            const { snapshot, events } = planStepEvents(yield* Ref.get(published), snap, {
              planId: args.taskId,
              taskId: args.taskId,
              ...(args.agentId ? { agentId: args.agentId } : {}),
              timestamp: Date.now(),
            });
            yield* Ref.set(published, snapshot);
            for (const event of events) {
              yield* bus.publish(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: args.site, tag: errorTag(err) })));
            }
          }
        }),
    };
  });
