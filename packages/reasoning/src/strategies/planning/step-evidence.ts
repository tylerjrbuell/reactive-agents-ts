// File: src/strategies/planning/step-evidence.ts
//
// The tool results a composite plan step's ReAct pass observed, as the step's
// full result.
//
// A composite step's `result` is the sub-kernel's closing text. That text need
// not carry the data the pass read: in Workstream H verdict N3 (2026-11-06) a
// read step ran as a composite (plan repair routes a tool step that lacks a
// required argument to one), read the file, closed with a guessed answer, and
// the dependent step's prompt carried only the guess. Later steps read
// `fullResult` first (prior-results.ts, `:full` refs, synthesis), so the
// observed payloads go there.

import type { KernelState } from "../../kernel/state/kernel-state.js";
import { resolveStoredToolObservation } from "../../kernel/loop/runner-helpers/state-queries.js";

/**
 * Full payloads of the successful tool results `state` observed from the
 * tools in `toolNames`, oldest first, identical payloads once. Compressed
 * previews resolve to the stored full content.
 *
 * @param state The pass's terminal kernel state.
 * @param toolNames The step's tools; results of other tools (meta-tools) are skipped.
 */
export function observedToolPayloads(state: KernelState, toolNames: readonly string[]): readonly string[] {
  const payloads: string[] = [];
  for (const step of state.steps) {
    const obs = step.metadata?.observationResult;
    if (step.type !== "observation" || obs?.success !== true || !toolNames.includes(obs.toolName)) continue;
    const storedKey = typeof step.metadata?.storedKey === "string" ? step.metadata.storedKey : undefined;
    const payload = resolveStoredToolObservation(step.content, state.scratchpad, storedKey);
    if (payload.trim().length > 0 && !payloads.includes(payload)) payloads.push(payload);
  }
  return payloads;
}

/**
 * Full result for a composite step, or `undefined` when its pass observed no
 * tool result. A step planned as one tool call (`step.toolName` set) keeps a
 * tool step's contract: its full result is the payload alone. Any other
 * composite step keeps its own text first and lists the payloads after it.
 *
 * @param output The step's result text (the sub-kernel's closing text).
 * @param payloads From {@link observedToolPayloads}.
 * @param plannedTool The step's `toolName`, when it was planned as a tool call.
 */
export function compositeFullResult(
  output: string,
  payloads: readonly string[],
  plannedTool: string | undefined,
): string | undefined {
  if (payloads.length === 0) return undefined;
  const joined = payloads.join("\n\n---\n\n");
  return plannedTool !== undefined ? joined : `${output}\n\nTool results from this step:\n${joined}`;
}
