// File: src/kernel/contract/satisfiability.ts
//
// GH #244 satisfiability preflight — the fast path for impossible tasks.
//
// The information already exists at iteration 0: the compiled contract's
// `action-required` requirements (run-contract.ts::detectActionNeed, task text
// only) plus the tool surface's relevance ranking
// (attend/tool-formatting.ts::filterToolsByRelevance, reused verbatim — no new
// classifier). When a run needs an external action AND zero available tools are
// relevant to the task AND no other path exists (no declared required tools,
// no nominated plausible tool), the run is unsatisfiable: the runner abstains
// immediately with a named capability reason instead of looping until the
// zero-evidence stand-down fires at iteration 2.
//
// Conservative by construction — every unknown returns null (satisfiable):
// unknown tool surface (schemas undefined), declared required tools (the
// required-tools guard owns that path), nominated tools (a plausible path
// exists), or any relevant tool. A false negative merely falls back to the
// stand-down (status quo); a false positive would wrongly kill a viable run,
// so the check only fires on the fully-determined unsatisfiable shape.

import { META_TOOLS } from "../state/kernel-constants.js";
import {
  filterToolsByRelevance,
  type ToolSchema,
} from "../capabilities/attend/tool-formatting.js";
import type { RunContract } from "./run-contract.js";

export interface ActionSatisfiabilityInput {
  /** The compiled run contract (reads its `action-required` requirements). */
  readonly contract: RunContract | undefined;
  /** The original task prose (relevance ranking input). */
  readonly task: string;
  /**
   * Tools actually available to this run. UNDEFINED means the surface is
   * unknown (caller has no schema list) — cannot judge, returns null.
   */
  readonly availableSchemas: readonly ToolSchema[] | undefined;
  /** Declared required tools — non-empty means the required-tools guard owns it. */
  readonly requiredTools: readonly string[];
  /** Plausibly-required tool names (runner-seeded nominations) — any means a path may exist. */
  readonly nominatedNames: readonly string[];
}

/** The unsatisfiable verdict: what capability is missing and what exists instead. */
export interface ActionSatisfiabilityVerdict {
  /** Harness-authored abstention reason — names the capability + available tools. */
  readonly reason: string;
  /** `capability:<slug>` entries for the abstention channel. */
  readonly missing: string[];
}

/**
 * Assess whether the run's action requirements are satisfiable by its tool
 * surface. Pure, deterministic, no LLM. Returns null when satisfiable OR when
 * the shape cannot be judged (conservative — never block a viable run).
 */
export function assessActionSatisfiability(
  input: ActionSatisfiabilityInput,
): ActionSatisfiabilityVerdict | null {
  const actions = (input.contract?.requirements ?? []).filter(
    (r) => r.kind === "action-required",
  );
  if (actions.length === 0) return null;
  // Unknown OR empty surface: no schema list (caller has none) or no ToolService
  // wired at all both mean "no information", NOT "provably tool-less" — the
  // tool-call resolver heals model-named calls against the universe, so a
  // viable run can never be judged from an empty list. Returns null; the
  // stand-down owns the shape.
  if (input.availableSchemas === undefined || input.availableSchemas.length === 0) return null;
  if (input.requiredTools.length > 0) return null;
  if (input.nominatedNames.length > 0) return null;

  // Meta tools (final-answer, recall, ...) cannot perform external actions —
  // judge relevance over domain tools only.
  const domain = input.availableSchemas.filter((s) => !META_TOOLS.has(s.name));
  const { primary } = filterToolsByRelevance(input.task, domain);
  if (primary.length > 0) return null;

  const capabilities: string[] = [];
  for (const a of actions) {
    const cap = a.spec.capability ?? a.id.replace(/^action:/, "");
    if (!capabilities.includes(cap)) capabilities.push(cap);
  }
  const available = domain.map((s) => s.name);
  const detail = actions.map((a) => a.spec.description).join("; ");
  return {
    reason:
      `missing capability: the task requires a ${capabilities.map((c) => `"${c}"`).join(", ")} action (${detail}) ` +
      `but no available tool is relevant to it. ` +
      `available=[${available.length > 0 ? available.join(", ") : "(none)"}]. ` +
      `Abstaining without spending model iterations on an impossible task.`,
    missing: capabilities.map((c) => `capability:${c}`),
  };
}
