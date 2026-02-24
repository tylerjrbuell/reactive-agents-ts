// File: src/context/compaction.ts
//
// Progressive multi-level context compaction using structured observations
// and context profiles. Implements Anthropic's "tool result clearing" and
// "decision preservation" patterns.

import type { ReasoningStep } from "../types/step.js";
import type { ObservationResult } from "../types/observation.js";
import type { ContextProfile } from "./context-profile.js";
import type { ContextBudget } from "./context-budget.js";

// ─── Compaction Levels ───
//
// Level 1: Full detail (within fullDetailSteps window)
// Level 2: One-line summary (within compactAfterSteps window)
// Level 3: Ultra-compact grouping ("Steps 3-8: file-read x2, web-search x1")
// Level 4: Dropped (only steps without preserveOnCompaction)

/**
 * Format a step in full detail (Level 1).
 */
export function formatStepFull(step: ReasoningStep): string {
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") {
    try {
      const parsed = JSON.parse(step.content);
      return `Action: ${parsed.tool}(${parsed.input ?? ""})`;
    } catch {
      return `Action: ${step.content}`;
    }
  }
  return step.content; // thought — render as-is
}

/**
 * Format a step as a one-line summary (Level 2).
 */
export function formatStepSummary(step: ReasoningStep): string {
  const full = formatStepFull(step);
  return full.length > 120 ? full.slice(0, 120) + "..." : full;
}

/**
 * Check if a step should be preserved during aggressive compaction.
 */
export function shouldPreserve(step: ReasoningStep): boolean {
  if (step.type !== "observation") return false;
  const obs = step.metadata?.observationResult;
  if (!obs) return false;
  return obs.preserveOnCompaction || !obs.success;
}

/**
 * Clear old tool data results — replace verbose data observations
 * with one-line summaries while keeping side-effects and errors intact.
 */
export function clearOldToolResults(
  steps: readonly ReasoningStep[],
  cutoffIndex: number,
): readonly ReasoningStep[] {
  return steps.map((step, idx) => {
    if (idx >= cutoffIndex) return step;
    if (step.type !== "observation") return step;

    const obs = step.metadata?.observationResult;
    // Preserve errors and side-effects
    if (!obs || !obs.success || obs.resultKind !== "data") return step;

    // Replace data results with a short summary
    const toolName = obs.toolName;
    const summary = `[${toolName}: data received, ${step.content.length} chars]`;
    return { ...step, content: summary };
  });
}

/**
 * Group consecutive tool sequences into an ultra-compact summary (Level 3).
 * E.g., "Steps 3-8: file-read x2, web-search x1, file-write x2"
 */
export function groupToolSequences(
  steps: readonly ReasoningStep[],
): string {
  const toolCounts = new Map<string, number>();
  let firstIdx = -1;
  let lastIdx = -1;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type === "action") {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      const toolName = step.metadata?.toolUsed ?? "unknown";
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
    }
  }

  if (toolCounts.size === 0) return "";

  const parts = Array.from(toolCounts.entries())
    .map(([tool, count]) => `${tool} x${count}`)
    .join(", ");

  return `[Steps ${firstIdx + 1}-${lastIdx + 1}: ${parts}]`;
}

/**
 * Progressive multi-level compaction.
 * Uses ObservationResult metadata and ContextProfile thresholds.
 */
export function progressiveSummarize(
  initialContext: string,
  steps: readonly ReasoningStep[],
  profile: ContextProfile,
  budget?: ContextBudget,
): string {
  if (steps.length === 0) return initialContext;

  const compactAfter = profile.compactAfterSteps;
  const fullDetail = profile.fullDetailSteps;

  // Under threshold — all steps in full detail (Level 1)
  if (steps.length <= compactAfter) {
    const stepLines = steps.map(formatStepFull).join("\n");
    return `${initialContext}\n\n${stepLines}`;
  }

  // Split into three zones:
  //   1. Ancient steps (Level 3 or 4 — ultra-compact or dropped)
  //   2. Middle steps (Level 2 — one-line summaries)
  //   3. Recent steps (Level 1 — full detail)
  const recentCutoff = steps.length - fullDetail;
  const ancientCutoff = Math.max(0, recentCutoff - fullDetail);

  const ancientSteps = steps.slice(0, ancientCutoff);
  const middleSteps = steps.slice(ancientCutoff, recentCutoff);
  const recentSteps = steps.slice(recentCutoff);

  const sections: string[] = [initialContext];

  // Level 3/4: Ancient steps — group or drop
  if (ancientSteps.length > 0) {
    // Check budget pressure — if tight, use Level 4 (drop non-preserved)
    const budgetPressure = budget
      ? budget.remaining < budget.totalBudget * 0.2
      : false;

    if (budgetPressure) {
      // Level 4: keep only preserved steps
      const preserved = ancientSteps.filter(shouldPreserve);
      if (preserved.length > 0) {
        sections.push(
          `[Early steps — ${ancientSteps.length} total, ${preserved.length} preserved]:\n` +
          preserved.map((s) => formatStepSummary(s)).join("\n"),
        );
      } else {
        sections.push(`[Early steps — ${ancientSteps.length} steps, details dropped]`);
      }
    } else {
      // Level 3: ultra-compact grouping
      const grouped = groupToolSequences(ancientSteps);
      if (grouped) {
        sections.push(grouped);
      }
    }
  }

  // Level 2: Middle steps — one-line summaries
  if (middleSteps.length > 0) {
    const summaryLines = middleSteps.map(formatStepSummary);
    sections.push(
      `[Earlier steps summary — ${middleSteps.length} steps]:\n${summaryLines.join("\n")}`,
    );
  }

  // Level 1: Recent steps — full detail
  const recentLines = recentSteps.map(formatStepFull).join("\n");
  sections.push(`[Recent steps]:\n${recentLines}`);

  return sections.join("\n\n");
}
