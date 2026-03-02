// File: src/strategies/shared/context-utils.ts
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";

/**
 * Format a single reasoning step in ReAct style for inclusion in context.
 * Observations get "Observation:" prefix; actions get "Action:" prefix (with
 * JSON tool-name extraction); thoughts are returned as-is.
 */
export function formatStepForContext(step: ReasoningStep): string {
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") {
    const parsed = (() => {
      try {
        return JSON.parse(step.content);
      } catch {
        return null;
      }
    })();
    return `Action: ${parsed?.tool ?? step.content}`;
  }
  return step.content; // thought — render as-is
}

/**
 * Build a compacted context string from initial context + step history.
 * Keeps the most recent `fullDetailSteps` steps in full detail (ReAct format).
 * Older steps are summarized to one line each to prevent O(n²) token growth.
 *
 * Thresholds come from the context profile (defaults: compactAfterSteps=6, fullDetailSteps=4).
 */
export function buildCompactedContext(
  initialContext: string,
  steps: readonly ReasoningStep[],
  profile: Pick<ContextProfile, "compactAfterSteps" | "fullDetailSteps"> | undefined,
): string {
  const compactAfterSteps = profile?.compactAfterSteps ?? 6;
  const fullDetailSteps = profile?.fullDetailSteps ?? 4;

  if (steps.length === 0) return initialContext;

  if (steps.length <= compactAfterSteps) {
    // Not enough steps to compact — rebuild context from all steps in ReAct format
    const stepLines = steps.map(formatStepForContext).join("\n");
    return `${initialContext}\n\n${stepLines}`;
  }

  // Split into old steps (summarized) and recent steps (full detail)
  const cutoff = steps.length - fullDetailSteps;
  const oldSteps = steps.slice(0, cutoff);
  const recentSteps = steps.slice(cutoff);

  // Summarize old steps: one line per step, truncated to 120 chars
  const summaryLines = oldSteps.map((s) => {
    const formatted = formatStepForContext(s);
    return formatted.length > 120 ? formatted.slice(0, 120) + "..." : formatted;
  });
  const summary = `[Earlier steps summary — ${oldSteps.length} steps]:\n${summaryLines.join("\n")}`;

  // Keep recent steps in full detail in ReAct format
  const recentLines = recentSteps.map(formatStepForContext).join("\n");

  return `${initialContext}\n\n${summary}\n\n[Recent steps]:\n${recentLines}`;
}
