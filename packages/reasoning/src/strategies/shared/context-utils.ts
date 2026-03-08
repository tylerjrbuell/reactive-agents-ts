// File: src/strategies/shared/context-utils.ts
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { stripThinking } from "./thinking-utils.js";

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
  // thought — strip any residual <think> blocks as defense-in-depth
  return stripThinking(step.content);
}

/**
 * Format a single reasoning step as a compact summary for old-step context.
 * Uses type-aware summarization instead of blind truncation.
 */
export function summarizeStepForContext(step: ReasoningStep): string {
  if (step.type === "action") {
    // Actions are already compact (just tool name)
    const parsed = (() => {
      try { return JSON.parse(step.content); } catch { return null; }
    })();
    return `Action: ${parsed?.tool ?? step.content}`;
  }

  if (step.type === "observation") {
    const toolName = step.metadata?.toolUsed ?? "tool";
    // Structured summary: tool name + data shape + size
    const content = step.content;
    const trimmed = content.trim();
    if (trimmed.startsWith("[")) {
      const count = (trimmed.match(/,/g)?.length ?? 0) + 1;
      return `Observation [${toolName}]: array(${count} items), ${content.length} chars`;
    }
    if (trimmed.startsWith("{")) {
      try {
        const keys = Object.keys(JSON.parse(trimmed));
        return `Observation [${toolName}]: {${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}}, ${content.length} chars`;
      } catch {
        // Not valid JSON — fall through
      }
    }
    // Plain text: first line, capped at 120 chars
    const firstLine = content.split("\n")[0] ?? content;
    return firstLine.length > 120
      ? `Observation [${toolName}]: ${firstLine.slice(0, 100)}...`
      : `Observation [${toolName}]: ${firstLine}`;
  }

  // Thought: extract last sentence as the conclusion
  const stripped = stripThinking(step.content);
  if (stripped.length <= 120) return stripped;
  // Find last sentence boundary
  const lastPeriod = stripped.lastIndexOf(". ", stripped.length - 1);
  if (lastPeriod > stripped.length * 0.3) {
    return stripped.slice(lastPeriod + 2);
  }
  return stripped.slice(0, 120) + "...";
}

/**
 * Build a compacted context string from initial context + step history.
 * Keeps the most recent `fullDetailSteps` steps in full detail (ReAct format).
 * Older steps are summarized using type-aware extraction to prevent O(n²) token growth.
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

  // Summarize old steps using type-aware extraction
  const summaryLines = oldSteps.map(summarizeStepForContext);
  const summary = `[Earlier steps summary — ${oldSteps.length} steps]:\n${summaryLines.join("\n")}`;

  // Keep recent steps in full detail in ReAct format
  const recentLines = recentSteps.map(formatStepForContext).join("\n");

  return `${initialContext}\n\n${summary}\n\n[Recent steps]:\n${recentLines}`;
}
