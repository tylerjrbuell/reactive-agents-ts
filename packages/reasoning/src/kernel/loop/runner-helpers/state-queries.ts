/**
 * runner-helpers/state-queries.ts — Read-only KernelState helpers used by runner.ts.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. Each helper is a
 * pure read over `KernelState` (or `KernelState["steps"]`) — no mutations,
 * no orchestration. Re-exported via runner.ts for caller stability.
 */

import {
  type KernelState,
  type KernelInput,
} from "../../../kernel/state/kernel-state.js";
import { getEffectiveMissingRequiredTools } from "../../../kernel/capabilities/verify/requirement-state.js";

/** Keys embedded in compressed tool observations (`[STORED: _tool_result_N | tool]`) */
export const STORED_TOOL_KEY_RE = /\[STORED:\s*(_tool_result_\d+)\s*\|/g;
/** Keys referenced by compression hints (e.g. `recall("_tool_result_5", ...)`). */
export const RECALL_TOOL_KEY_RE = /recall\("(_tool_result_\d+)"/g;

export function missingRequiredToolsForInput(
  steps: KernelState["steps"],
  input: KernelInput,
): readonly string[] {
  return getEffectiveMissingRequiredTools(
    steps,
    input.requiredTools ?? [],
    input.requiredToolQuantities,
  );
}

/**
 * When an observation is a compressed preview, replace it with full text from the kernel
 * scratchpad so harness / output-gate paths do not hallucinate from ASCII banners only.
 */
export function resolveStoredToolObservation(
  content: string,
  scratchpad: ReadonlyMap<string, string>,
  preferredKey?: string,
): string {
  const keys = [...new Set([
    ...(preferredKey ? [preferredKey] : []),
    ...[...content.matchAll(STORED_TOOL_KEY_RE)].map((m) => m[1]!),
    ...[...content.matchAll(RECALL_TOOL_KEY_RE)].map((m) => m[1]!),
  ])];
  if (keys.length === 0) return content;
  const payloads = keys
    .map((k) => scratchpad.get(k))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (payloads.length === 0) return content;
  return payloads.join("\n\n---\n\n");
}

/**
 * Extract the readyToAnswer flag from the most recent pulse observation step.
 * Returns false when there is no pulse observation or the JSON cannot be parsed.
 */
export function getLastPulseReadyToAnswer(state: KernelState): boolean {
  const pulseObs = [...state.steps]
    .reverse()
    .find(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.toolName === "pulse",
    );
  if (!pulseObs) return false;
  try {
    const parsed = JSON.parse(pulseObs.content ?? "");
    return parsed?.readyToAnswer === true;
  } catch {
    return false;
  }
}

/** Error strings from recent failed tool observations — feeds ICS nudge content. */
export function getLastErrors(state: KernelState): readonly string[] {
  return state.steps
    .filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    )
    .slice(-2)
    .map(
      (s) =>
        s.metadata?.observationResult?.displayText ||
        s.content ||
        "unknown error",
    )
}
