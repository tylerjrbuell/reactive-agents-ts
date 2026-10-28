/**
 * state/checklist-migrate.ts — one-shot migration of the retired global todo
 * list (`_todo:<taskId>` scratchpad keys) into `checklist-item` ledger facts.
 *
 * Runs once at resume, before the first iteration. Checkpoints written before
 * the ledger-backed `todo` carry the list in `state.scratchpad`; without this
 * the list would vanish (or, worse, linger as a second truth). After migration
 * every `_todo:*` key is gone, so a second call is a no-op.
 *
 * Plan: wiki/Planning/Implementation-Plans/2026-10-28-plan-and-goal-primitives.md (Task 4).
 */
import type { ChecklistItemOp } from "@reactive-agents/core";
import { recordChecklistItems } from "../ledger/emit.js";
import { transitionState, type KernelState } from "./kernel-state.js";

const LEGACY_PREFIX = "_todo:";

type LegacyStatus = "pending" | "in_progress" | "done";

interface LegacyItem {
  readonly id: number;
  readonly text: string;
  readonly status: LegacyStatus;
}

const isLegacyItem = (t: unknown): t is LegacyItem =>
  typeof t === "object" &&
  t !== null &&
  typeof (t as LegacyItem).id === "number" &&
  typeof (t as LegacyItem).text === "string" &&
  ["pending", "in_progress", "done"].includes((t as LegacyItem).status);

/** Parse a serialized legacy list, dropping malformed entries (never throws). */
function parseLegacy(serialized: string | undefined): readonly LegacyItem[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isLegacyItem) : [];
  } catch {
    return [];
  }
}

/**
 * Migrate the legacy todo list for `taskId` into ledger facts and delete every
 * `_todo:*` scratchpad key. Source key: the exact `_todo:<taskId>`; if absent
 * and exactly one `_todo:*` key exists, that one. Mints nothing when the ledger
 * already holds `checklist-item` facts. Returns `state` by identity when there
 * is no legacy key.
 */
export function migrateLegacyTodo(state: KernelState, taskId: string): KernelState {
  const legacyKeys = [...state.scratchpad.keys()].filter((k) => k.startsWith(LEGACY_PREFIX));
  if (legacyKeys.length === 0) return state;

  const exact = `${LEGACY_PREFIX}${taskId}`;
  const sourceKey = state.scratchpad.has(exact) ? exact : legacyKeys.length === 1 ? legacyKeys[0] : undefined;
  const items = sourceKey === undefined ? [] : parseLegacy(state.scratchpad.get(sourceKey));
  const alreadyMigrated = (state.ledger ?? []).some((e) => e.kind === "checklist-item");

  const scratchpad = new Map(state.scratchpad);
  for (const k of legacyKeys) scratchpad.delete(k);

  if (items.length === 0 || alreadyMigrated) return transitionState(state, { scratchpad });

  const changes: ChecklistItemOp[] = [
    { op: "add", items: items.map((t) => ({ id: String(t.id), title: t.text })) },
    ...items.flatMap((t): ChecklistItemOp[] =>
      t.status === "pending"
        ? []
        : [{ op: "status", id: String(t.id), status: t.status === "done" ? "completed" : "in_progress" }],
    ),
  ];
  return transitionState(state, {
    scratchpad,
    ledger: recordChecklistItems(
      state.ledger,
      changes.map((change) => ({ iteration: state.iteration, change })),
    ),
  });
}
