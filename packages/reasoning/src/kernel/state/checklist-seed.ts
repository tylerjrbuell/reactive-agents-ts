/**
 * state/checklist-seed.ts — seed a run's advisory todo list from a prior turn
 * of the SAME conversation (conversation-level, not message-level, todo).
 *
 * The seed is written as ordinary `checklist-item` ledger facts (one `add` batch,
 * then a `status` op per non-pending item) through the announced ledger-write
 * seam (`recordChecklistItems`). Because the `todo` tool is a fold of those
 * facts, `list/start/done` operate on seeded items with their original ids and
 * `add` continues numbering after the max id — no second truth, no tool change.
 * The runner publishes the seeded facts as ONE `restored` batch, so consumers
 * treat them as a seed, not as new model actions.
 */
import type { ChecklistItemOp, ChecklistItemStatus } from "@reactive-agents/core";
import { recordChecklistItems } from "../ledger/emit.js";
import { transitionState, type KernelInput, type KernelState } from "./kernel-state.js";

/** One advisory todo item carried over from a prior turn of the same conversation. */
export interface AdvisorySeedItem {
  readonly id: string;
  readonly title: string;
  readonly status: ChecklistItemStatus;
}

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched; the field
// lives next to the code that reads it. Field name is the contract.
declare module "./kernel-state.js" {
  interface KernelInput {
    /** Advisory todo items from a prior turn of the same conversation. Absent/empty => no-op. */
    readonly initialAdvisory?: readonly AdvisorySeedItem[];
  }
}

/**
 * Seed `state.ledger` from `input.initialAdvisory`. Returns `state` by identity
 * when there is nothing to seed, on a resumed run (its ledger already is the
 * truth), or when the ledger already holds checklist facts (never double-seeds).
 */
export function seedInitialAdvisory(state: KernelState, input: Pick<KernelInput, "initialAdvisory" | "resumeState">): KernelState {
  const seed = input.initialAdvisory;
  if (seed === undefined || seed.length === 0 || input.resumeState !== undefined) return state;
  if ((state.ledger ?? []).some((e) => e.kind === "checklist-item")) return state;
  const changes: ChecklistItemOp[] = [
    { op: "add", items: seed.map((t) => ({ id: t.id, title: t.title })) },
    ...seed.flatMap((t): ChecklistItemOp[] => (t.status === "pending" ? [] : [{ op: "status", id: t.id, status: t.status }])),
  ];
  return transitionState(state, {
    ledger: recordChecklistItems(state.ledger, changes.map((change) => ({ iteration: state.iteration, change }))),
  });
}
