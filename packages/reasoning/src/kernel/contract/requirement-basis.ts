// File: src/kernel/contract/requirement-basis.ts
//
// The basis of a requirement: what entitles it to hold a run back.
//
// Terminal-decision audit (wiki/Research/Harness-Reports/2026-11-14-terminal-decision-basis-audit.md):
// 9 of 12 wrong failures came from requirements the harness INFERRED from task
// prose. The rule that falls out: a requirement may block success only when it
// is declared (the builder / a task contract named it) or is a literal anchor
// checkable against a receipt (a file path, a listed input). A semantic category
// inferred from prose ("this sounds like an email task") may only advise.
//
//   declared   - the caller named it (requiredTools, a TaskContract).
//   evidence   - a literal anchor checked against a ledger receipt (an artifact
//                path in the task text, a listed input, a claimed action that no
//                successful call backs).
//   heuristic  - a semantic category inferred from prose, or a default floor.
//
// Pure, no I/O. The exit gate reads it to route heuristic items to guidance
// instead of the outstanding list (loop/contract-outstanding.ts).

import type { TaskRequirement } from "./run-contract.js";

/** What entitles an outstanding item to block a run (see the file header). */
export type RequirementBasis = "declared" | "evidence" | "heuristic";

/** True when an item of this basis may hold a run back; heuristic items only advise. */
export const blocksTerminal = (basis: RequirementBasis): boolean => basis !== "heuristic";

/**
 * The basis of one compiled requirement. Unknown shapes are `declared`: an item
 * with no provenance blocks exactly as it did before the basis existed.
 */
export function requirementBasis(r: Pick<TaskRequirement, "kind" | "provenance">): RequirementBasis {
  const source = r.provenance?.source;
  // The action category (send / create / post ... an external resource) is read
  // from prose; only a caller that declared it could make it block.
  if (r.kind === "action-required") return source === "task-text" ? "heuristic" : "declared";
  if (source === undefined || source === "required-tools" || source === "task-contract") return "declared";
  if (source === "floor") return r.kind === "question-answered" ? "heuristic" : "evidence";
  return "evidence"; // task-text literal anchor: artifact path, listed input, write target
}
