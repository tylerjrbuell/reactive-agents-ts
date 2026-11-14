// File: src/kernel/loop/contract-outstanding.ts
//
// The contract part of the exit gate's outstanding list, split by BASIS
// (contract/requirement-basis.ts): what may hold a run back, and what may only
// advise. Terminal-decision audit 2026-11-14: heuristics holding veto power
// produced 9 of 12 wrong failures; a literal anchor checked against a receipt
// may block, a semantic category inferred from prose may not.
//
//   blocking  - declared required tools, unmet delivery conditions (a declared
//               or literal artifact / input), and an answer-claimed action that
//               no successful call backs. Each carries its basis.
//   advisory  - an action requirement inferred from task prose that nothing
//               landed, and a derived SideEffectLanded condition. Rendered to
//               the model as guidance, stamped on the gate's trace, never a
//               reason to deny or fail.
//
// Pure reads of the kernel state; no I/O.

import type { KernelInput, KernelState } from "../state/kernel-state.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { describeUnmet } from "../capabilities/verify/post-conditions.js";
import { describeUnbackedClaim, succeededToolNames, unbackedClaimedActions } from "../capabilities/verify/claimed-actions.js";
import { resolveFabricationGuardMode } from "../capabilities/verify/evidence-grounding.js";
import { deliveryConditions } from "../contract/declared-deliverables.js";
import { blocksTerminal, type RequirementBasis } from "../contract/requirement-basis.js";
import { unlandedActions } from "../contract/satisfiability.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";

/** One outstanding contract item and what entitles it to block. */
export interface BasedItem {
  readonly text: string;
  readonly basis: RequirementBasis;
}

/** The contract's outstanding work, split into what blocks and what only advises. */
export interface ContractOutstanding {
  readonly blocking: readonly BasedItem[];
  /** Heuristic-basis items: guidance only. */
  readonly advisory: readonly string[];
}

/** `describeUnmet` phrases a list as one sentence; the gate lists items one by one. */
const itemOf = (sentence: string): string =>
  sentence.replace(/^You still must:\s*/, "").replace(/\.$/, "");

/** Classify the contract's outstanding items for `output` (see the file header). */
export function classifyContractOutstanding(
  state: KernelState,
  input: KernelInput,
  output: string,
): ContractOutstanding {
  const blocking: BasedItem[] = [];
  const advisory: string[] = [];
  const add = (text: string, basis: RequirementBasis): void => {
    if (text.length === 0) return;
    if (!blocksTerminal(basis)) {
      if (!advisory.includes(text)) advisory.push(text);
    } else if (!blocking.some((b) => b.text === text)) {
      blocking.push({ text, basis });
    }
  };
  const missing = missingRequiredToolsForInput(state, input);
  for (const tool of missing) add(`call the \`${tool}\` tool`, "declared");
  const conditions = deliveryConditions(state.meta) ?? [];
  if (conditions.length > 0) {
    const { unmet } = verifyDelivery(conditions, { steps: state.steps, output, ledger: state.ledger });
    for (const c of unmet) {
      // A derived side-effect condition is a verb-x-noun guess from prose; a
      // required-tool call is declared; the rest are literal anchors.
      const basis: RequirementBasis =
        c.kind === "SideEffectLanded" ? "heuristic" : c.kind === "ToolCalled" ? "declared" : "evidence";
      add(itemOf(describeUnmet([c])), basis);
    }
  }
  // An external action nothing in the run landed (meta-only calls do not count).
  for (const a of unlandedActions(state.meta.runContract, state.steps, state.ledger)) {
    add(`perform the requested action: ${a.description}`, a.basis);
  }
  // An action the answer claims that no successful tool call backs (claimed-actions.ts).
  // A required tool already named above is not repeated. Respects the fabrication-guard off switch.
  if (resolveFabricationGuardMode(input.fabricationGuard) !== "off") {
    const skip = new Set(missing);
    const tools = (input.availableToolSchemas ?? []).map((t) => t.name).filter((t) => !skip.has(t));
    for (const c of unbackedClaimedActions(output, tools, succeededToolNames(state.steps))) {
      add(describeUnbackedClaim(c), "evidence");
    }
  }
  return { blocking, advisory };
}

/**
 * The basis of each entry of a gate outstanding list, in order. Items the
 * contract classified keep their basis; a required tool the run gave up on
 * (`evidenceLines`) is evidence; anything else (answer shape, a guard's own
 * line) is the heuristic floor.
 */
export function basisOfOutstanding(
  outstanding: readonly string[],
  classified: ContractOutstanding,
  evidenceLines: readonly string[],
): readonly RequirementBasis[] {
  return outstanding.map((item) => {
    const hit = classified.blocking.find((b) => b.text === item);
    if (hit !== undefined) return hit.basis;
    return evidenceLines.includes(item) ? "evidence" : "heuristic";
  });
}
