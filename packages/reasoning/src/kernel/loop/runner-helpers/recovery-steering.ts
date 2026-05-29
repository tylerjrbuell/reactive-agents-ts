/**
 * runner-helpers/recovery-steering.ts — Tool-failure recovery + steering guidance.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. Used by runKernel
 * when a stall guard fires or the loop detector trips — the runner asks
 * `getToolFailureRecovery()` whether failed tool paths still have viable
 * alternatives, then `buildRecoverySteeringGuidance()` formats a user-facing
 * nudge that re-points the model at an alternate path.
 */

import {
  type KernelState,
  type KernelInput,
} from "../../../kernel/state/kernel-state.js";
import {
  buildSuccessfulToolCallCounts,
  getEffectiveMissingRequiredTools,
} from "../../../kernel/capabilities/verify/requirement-state.js";
import { META_TOOLS as RUNNER_META_TOOLS } from "../../../kernel/state/kernel-constants.js";

export type ToolFailureRecovery = {
  readonly failedUnresolved: readonly string[];
  readonly alternativeCandidates: readonly string[];
};

export type RecoverySteeringKind = "stall" | "loop";

export function buildRecoverySteeringGuidance(
  recovery: ToolFailureRecovery,
  failureRecoveryRedirects: number,
  maxFailureRecoveryRedirects: number,
  kind: RecoverySteeringKind,
): string {
  const nextPath =
    recovery.alternativeCandidates[0] ??
    recovery.failedUnresolved[0] ??
    "an available tool";
  const failedList = recovery.failedUnresolved.join(", ");
  const progress = `(${failureRecoveryRedirects}/${maxFailureRecoveryRedirects})`;

  if (recovery.alternativeCandidates.length > 0) {
    if (kind === "stall") {
      return (
        `Recovery required: prior tool path failed (${failedList}). Try an alternate path now: ${nextPath}. Do not finalize yet. ${progress}`
      );
    }
    return (
      `Recovery required: loop detected after failed tool path (${failedList}). Try alternate path ${nextPath} before completion. ${progress}`
    );
  }
  if (kind === "stall") {
    return (
      `Recovery required: prior tool path failed (${failedList}). Retry ${nextPath} with corrected arguments/evidence. Do not finalize yet. ${progress}`
    );
  }
  return (
    `Recovery required: loop detected after failed tool path (${failedList}). Retry ${nextPath} with corrected arguments before completion. ${progress}`
  );
}

/**
 * Identify whether failed tool paths still have viable alternatives.
 *
 * A tool is "failed unresolved" when we saw at least one failed observation and
 * no successful observation for that same tool yet.
 */
export function getToolFailureRecovery(
  state: KernelState,
  input: KernelInput,
): ToolFailureRecovery {
  const successCounts = buildSuccessfulToolCallCounts(state.steps);
  const successful = new Set<string>(Object.keys(successCounts));
  const failed = new Set<string>();

  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as
      | { readonly success?: boolean; readonly toolName?: string }
      | undefined;
    const toolName = result?.toolName;
    if (!toolName || RUNNER_META_TOOLS.has(toolName)) continue;

    if (result.success === false && (successCounts[toolName] ?? 0) === 0) {
      failed.add(toolName);
    }
  }

  const required = input.requiredTools ?? [];
  const requiredStillNeeded = getEffectiveMissingRequiredTools(
    state.steps,
    required,
    input.requiredToolQuantities,
  );
  const relevant = input.relevantTools ?? [];
  const available = (input.availableToolSchemas ?? []).map((t) => t.name);

  const candidatePool = [...new Set([...requiredStillNeeded, ...required, ...relevant, ...available])]
    .filter((name) => !RUNNER_META_TOOLS.has(name));

  const failedUnresolved = [...failed].filter((name) => !successful.has(name));
  if (failedUnresolved.length === 0) {
    return { failedUnresolved: [], alternativeCandidates: [] };
  }

  const failedUnresolvedSet = new Set(failedUnresolved);
  const requiredStillNeededSet = new Set(requiredStillNeeded);
  const alternativeCandidates = candidatePool.filter((name) => {
    if (failedUnresolvedSet.has(name)) return false;
    return requiredStillNeededSet.has(name) || !successful.has(name);
  });

  return {
    failedUnresolved,
    alternativeCandidates,
  };
}
