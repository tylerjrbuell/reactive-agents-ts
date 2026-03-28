import type { ReasoningStep } from "../types/index.js";

/**
 * The current phase of a task execution.
 * Classified deterministically from kernel signals — no LLM call required.
 */
export type TaskPhase =
  | "orient"
  | "gather"
  | "synthesize"
  | "produce"
  | "verify";

/**
 * Classify the current task phase from kernel signals.
 * Pure function — deterministic, no side effects.
 */
export function classifyTaskPhase(signals: {
  readonly iteration: number;
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly steps: readonly ReasoningStep[];
}): TaskPhase {
  const { iteration, toolsUsed, requiredTools, steps } = signals;

  const missingRequired = requiredTools.filter((t) => !toolsUsed.has(t));

  const hasWrittenOutput = steps.some(
    (s) =>
      s.type === "observation" &&
      s.metadata?.observationResult?.success === true &&
      (s.metadata?.toolCall as { name?: string } | undefined)?.name?.includes("write"),
  );

  if (iteration <= 1 && toolsUsed.size === 0) return "orient";
  if (missingRequired.length > 0) return "gather";
  if (hasWrittenOutput) return "verify";
  if (requiredTools.length > 0 && missingRequired.length === 0) return "synthesize";
  return "produce";
}
