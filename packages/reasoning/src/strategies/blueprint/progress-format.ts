// File: src/strategies/blueprint/progress-format.ts
//
// Pure formatters that surface what the blueprint agent is ATTEMPTING, so a
// user watching a live run can follow the agent's intent — not just raw tool
// calls. Two views:
//   - formatPlanListing: the whole plan, shown live the moment it's generated.
//   - formatStepAttempt: a per-step "▶ running" line, emitted by the worker the
//     moment each step starts (so parallel-wave steps each announce themselves).
//
// Kept pure (no Effect, no I/O) so they're trivially testable; the strategy /
// worker own the actual event emission.

import type { Plan, PlanStep } from "../../types/plan.js";

/** One-line intent suffix for a step: `→ toolName` for tool calls, `(type)` else. */
function stepIntent(step: PlanStep): string {
  if (step.type === "tool_call") {
    return step.toolName ? ` → ${step.toolName}` : "";
  }
  return ` (${step.type})`;
}

/**
 * Render the full plan as a numbered, human-readable list so the user sees
 * every step the agent intends to take before execution begins.
 */
export function formatPlanListing(plan: Plan): string {
  return plan.steps
    .map((s) => `  ${s.seq}. ${s.title}${stepIntent(s)}`)
    .join("\n");
}

/**
 * Render the "now running" line for a single step. `position`/`total` locate it
 * among the plan's tool steps (e.g. `1/3`). Emitted by the worker at dispatch
 * time so the user can see what the agent is attempting in real time.
 */
export function formatStepAttempt(step: PlanStep, total: number): string {
  const pos = `${step.seq}/${total}`;
  return `▶ Step ${pos}: ${step.title}${stepIntent(step)}`;
}
