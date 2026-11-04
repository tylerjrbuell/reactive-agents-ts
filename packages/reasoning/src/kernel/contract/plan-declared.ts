// File: src/kernel/contract/plan-declared.ts
//
// Plan-declared deliverables (Plan 8 L7 / G2, source `plan-declared`).
//
// When a run writes its own `todo` list, the OUTPUT files those items name are
// the concrete form of what the task may have named only as a template
// ("for each notes-N.txt, write out-N.txt"). This module turns the run's own
// `add` ops into per-item file deliverables on the run contract through the
// existing seam (`addDeclaredDeliverables`); the terminal gates then hold the
// run to write EVIDENCE for each declared file (ArtifactProduced), never to
// the item's model-owned done/pending status.
//
// Rules:
//   - Output paths come from the task-text deriver `deriveDeliverablePaths`
//     (write targets only; read inputs and template placeholders are dropped).
//     An item that names no output path stays advisory.
//   - Only `add` ops staged by THIS run's act rounds count. Seeded prior-turn
//     items (checklist-seed.ts) and merged sub-agent facts never pass through a
//     round's staging, so they never declare anything.
//   - Declaration is append-only: the checklist has no remove/cancel op, and a
//     later status change never undeclares a file (a model cannot escape the
//     gate by marking or re-planning the item).
//   - Plan posture declares nothing: that posture withholds every writing tool.
//
// Pure, deterministic, NO LLM, NO fs.

import type { ChecklistItemOp, RunPosture } from "@reactive-agents/core";
import { deriveDeliverablePaths } from "../capabilities/verify/derive-conditions.js";
import type { DeclaredDeliverable } from "./declared-deliverables.js";
import { addDeclaredDeliverables, type RunContract } from "./run-contract.js";

/**
 * The output files named by the items that `changes` ADD, in item order,
 * de-duplicated. Status ops contribute nothing.
 */
export function planDeclaredOutputs(changes: readonly ChecklistItemOp[]): readonly DeclaredDeliverable[] {
  const out: DeclaredDeliverable[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    if (change.op !== "add") continue;
    for (const item of change.items) {
      for (const path of deriveDeliverablePaths(item.title)) {
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ kind: "file", path });
      }
    }
  }
  return out;
}

/**
 * Widen `contract` with the output files a round's checklist changes declare.
 * Returns `contract` itself (same reference, possibly undefined) when there is
 * no contract, the run is in plan posture, or nothing new is declared — so runs
 * whose todo items name no output file are byte-identical.
 */
export function declarePlanOutputs(
  contract: RunContract | undefined,
  changes: readonly ChecklistItemOp[],
  posture: RunPosture | undefined,
): RunContract | undefined {
  if (contract === undefined || posture === "plan") return contract;
  const items = planDeclaredOutputs(changes);
  if (items.length === 0) return contract;
  const widened = addDeclaredDeliverables(contract, items, "plan-declared");
  return widened.requirements.length === contract.requirements.length ? contract : widened;
}
