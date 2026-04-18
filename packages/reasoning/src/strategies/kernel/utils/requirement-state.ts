import type { ReasoningStep } from "../../../types/index.js";
import { META_TOOLS as META_TOOL_NAMES } from "../kernel-constants.js";

interface ObservationResultLike {
  readonly success?: boolean;
  readonly toolName?: string;
  readonly delegatedToolsUsed?: readonly string[];
}

function isCountableToolName(toolName: string): boolean {
  return toolName.length > 0 && !META_TOOL_NAMES.has(toolName);
}

function incrementCount(
  counts: Record<string, number>,
  toolName: string,
): void {
  if (!isCountableToolName(toolName)) return;
  counts[toolName] = (counts[toolName] ?? 0) + 1;
}

/**
 * Count successful tool calls from observation metadata.
 *
 * Counts are based only on successful observations (`observationResult.success === true`).
 * Delegated tool usage is credited once per delegated tool for each successful
 * delegation observation, which allows parent delegation results to satisfy
 * required child-tool quotas.
 */
export function buildSuccessfulToolCallCounts(
  steps: readonly ReasoningStep[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const step of steps) {
    if (step.type !== "observation") continue;

    const result = step.metadata?.observationResult as ObservationResultLike | undefined;
    if (result?.success !== true) continue;

    const observedTools = new Set<string>();
    if (typeof result.toolName === "string" && result.toolName.length > 0) {
      observedTools.add(result.toolName);
    }
    if (Array.isArray(result.delegatedToolsUsed)) {
      for (const delegatedToolName of result.delegatedToolsUsed) {
        if (typeof delegatedToolName === "string" && delegatedToolName.length > 0) {
          observedTools.add(delegatedToolName);
        }
      }
    }
    for (const toolName of observedTools) {
      incrementCount(counts, toolName);
    }
  }

  return counts;
}

/**
 * Returns the subset of required tools whose successful call counts are still
 * below their required quantity floor.
 */
export function getMissingRequiredToolsByCount(
  successfulCounts: Readonly<Record<string, number>>,
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const quantities = requiredToolQuantities ?? {};
  return requiredTools.filter(
    (toolName) => (successfulCounts[toolName] ?? 0) < (quantities[toolName] ?? 1),
  );
}

/**
 * Convenience wrapper that computes missing required tools directly from steps.
 */
export function getMissingRequiredToolsFromSteps(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const successfulCounts = buildSuccessfulToolCallCounts(steps);
  return getMissingRequiredToolsByCount(
    successfulCounts,
    requiredTools,
    requiredToolQuantities,
  );
}

/**
 * Count all tool call attempts from observation metadata, regardless of success.
 * Used to detect tools that have been tried but never succeeded.
 */
export function buildAttemptedToolCallCounts(
  steps: readonly ReasoningStep[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const step of steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as ObservationResultLike | undefined;
    if (typeof result?.toolName !== "string" || result.toolName.length === 0) continue;
    if (!isCountableToolName(result.toolName)) continue;
    counts[result.toolName] = (counts[result.toolName] ?? 0) + 1;
  }

  return counts;
}

/**
 * Returns required tools that were attempted at least once but never succeeded.
 * These are "permanently failed" from the harness perspective — nudging the model
 * to retry them will only cause loops.
 */
export function getPermanentlyFailedRequiredTools(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
): readonly string[] {
  const successfulCounts = buildSuccessfulToolCallCounts(steps);
  const attemptedCounts = buildAttemptedToolCallCounts(steps);
  return requiredTools.filter(
    (toolName) =>
      (attemptedCounts[toolName] ?? 0) > 0 &&
      (successfulCounts[toolName] ?? 0) === 0,
  );
}

/**
 * Like getMissingRequiredToolsFromSteps but excludes permanently-failed tools.
 *
 * Use this for nudge messages and completion guards — if a tool was attempted
 * and always failed, the model already knows and repeating the nudge causes loops.
 * Tools that were never attempted remain in the list (genuinely missing).
 */
export function getEffectiveMissingRequiredTools(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const missing = getMissingRequiredToolsFromSteps(steps, requiredTools, requiredToolQuantities);
  const permanentlyFailed = new Set(getPermanentlyFailedRequiredTools(steps, requiredTools));
  return missing.filter((toolName) => !permanentlyFailed.has(toolName));
}
