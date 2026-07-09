// File: src/kernel/assessment/pace-actions.ts
//
// E3 — the pace-band ACTUATORS. E1 computes `assessment.pace.band`; E2 migrated
// the guards to CONSUME the assessment; E3 turns the bands into ACTIONS on the
// harness actuators:
//
//   economize (≥0.60) → gateway budgetClass downshift for NON-synthesis calls
//   triage    (≥0.80) → steer line naming the OUTSTANDING requirements
//   terminal  (≥0.95) → forced generous synthesis BEFORE the budget cliff
//
// These pure selectors READ the cached band and say WHAT to do; the wiring sites
// (llm-gateway `resolveOutputBudget`, iterate-pass) drive the actuators.
//
// DAG law: they READ `assessment.pace.band` (computed UPSTREAM by E1 in the same
// iteration). They never recompute assessment, never mutate the ledger, never
// hold a private counter — the pace band is the single shared currency.
//
// LIFT-GATE DISCIPLINE: every selector is OPT-IN behind the long-horizon profile
// (`horizonActive`). Profile OFF → the neutral value (`undefined` / `false`) so
// each actuator keeps its byte-identical legacy path. Pace actions CHANGE
// behavior; the bench gate blesses them before they can become default.

import type { RunContract } from "../contract/run-contract.js";
import type { PaceBand, RunAssessment } from "./assess.js";

/**
 * economize actuator (band `economize`-or-worse, burnRatio ≥ 0.60): the pace band
 * the gateway should downshift NON-synthesis output budgets toward, or
 * `undefined` when no downshift applies. Fires for every non-`green` band — once
 * the run is past the economize threshold it keeps conserving on every
 * non-synthesis call, escalating through triage/terminal (terminal itself never
 * reaches a think turn — it pre-empts with forced synthesis first). OFF, or a
 * `green` band, → `undefined` → the gateway resolves budgets exactly as today.
 */
export function downshiftBudgetBand(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): PaceBand | undefined {
  if (!horizonActive) return undefined;
  const band = assessment?.pace.band;
  return band !== undefined && band !== "green" ? band : undefined;
}

/**
 * The human/steering descriptions of the requirements still OUTSTANDING, in
 * contract order. Pure — used by both the triage steer and the terminal partial
 * label. An id with no matching contract requirement falls back to the raw id
 * (never drops a signal).
 *
 * F3: the self-critique "answer" floor (`acceptance: "self-critique"`, no
 * deterministic condition) is ALWAYS outstanding by construction — assess() can
 * never mark a condition-less requirement met. It carries no actionable steering
 * ("produce a substantive answer" is a tautology at triage/terminal), so it is
 * excluded from the steer/partial text. The pace BAND already ignores it
 * (assess() escalates only on deterministic outstanding work), so this only
 * de-noises the wording — it never changes when triage/terminal fire.
 */
export function outstandingDescriptions(
  contract: RunContract,
  assessment: RunAssessment,
): readonly string[] {
  return assessment.requirements.outstanding
    .map((id) => ({ id, req: contract.requirements.find((r) => r.id === id) }))
    // Drop the self-critique floor; keep unmatched ids (id fallback) so a real
    // requirement whose contract entry is missing is never silently dropped.
    .filter(({ req }) => req?.spec.acceptance !== "self-critique")
    .map(({ id, req }) => req?.spec.description ?? id);
}

/**
 * triage actuator (band === `triage`, burnRatio ≥ 0.80): the steer line naming
 * the OUTSTANDING requirements, or `undefined` when it should not fire (profile
 * off, not in triage, or nothing outstanding). Focuses the model on what is
 * undone while budget remains — the guidance channel renders it next think turn.
 */
export function triageSteerText(
  horizonActive: boolean,
  contract: RunContract,
  assessment: RunAssessment | undefined,
): string | undefined {
  if (!horizonActive) return undefined;
  if (assessment?.pace.band !== "triage") return undefined;
  if (assessment.requirements.outstanding.length === 0) return undefined;
  const descs = outstandingDescriptions(contract, assessment);
  const pct = Math.round(assessment.pace.burnRatio * 100);
  return (
    `Budget is ~${pct}% spent with work still outstanding. Prioritize the ` +
    `remaining requirement(s) and PRODUCE them now — do not start new tangents: ` +
    `${descs.join("; ")}.`
  );
}

/**
 * terminal actuator (band === `terminal`, burnRatio ≥ 0.95): whether to FORCE a
 * final synthesis before the `budget_exceeded` cliff can fire and discard the
 * answer (audit 05-#1). OFF, or any lower band, → `false` → the loop proceeds
 * exactly as today (and the cliff owns the over-budget outcome).
 */
export function shouldForceTerminalSynthesis(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && assessment?.pace.band === "terminal";
}
