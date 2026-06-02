/**
 * runner-helpers/deliverable.ts — Harness-owned deliverable assembly.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. Defines the
 * source-tagged {@link Deliverable} the runner ships at termination, plus
 * the supporting filters that decide whether each observation/thought
 * step earns a place in it. `runner.ts` re-exports `Deliverable` and
 * `assembleDeliverable` so external callers (e.g. `output-quality-gate.test.ts`)
 * continue importing from `kernel/loop/runner.js`.
 *
 * Priority order is a load-bearing contract (see assembleDeliverable JSDoc):
 *   1. model-authored synthesizing thought (no forced LLM re-synthesis)
 *   2. concatenated successful non-meta tool observations (raw_artifacts)
 *   3. empty-state sentinel
 */

import {
  type KernelState,
} from "../../../kernel/state/kernel-state.js";
import { META_TOOLS as RUNNER_META_TOOLS } from "../../../kernel/state/kernel-constants.js";
import { resolveStoredToolObservation } from "./state-queries.js";

/** Minimum thought length to be treated as a model-authored final synthesis. */
export const MIN_MODEL_SYNTHESIS_LENGTH = 100;

/**
 * A harness-assembled deliverable, source-tagged.
 *
 *  - `model_synthesis` — a substantive trailing thought authored by the model.
 *    In React-loop semantics, that thought IS the final answer; raw tool
 *    observations are the evidence that fed it. Downstream gates should treat
 *    this as a model-authored output (no forced LLM re-synthesis).
 *  - `raw_artifacts` — concatenated tool observation bodies. The model never
 *    produced a synthesizing thought, so the harness ships evidence directly.
 *    Downstream gates should attempt LLM synthesis to format it for the user.
 */
export type Deliverable = {
  readonly content: string;
  readonly source: "model_synthesis" | "raw_artifacts";
};

/**
 * Assemble the harness-owned deliverable.
 *
 * Priority order (design contract):
 *   1. Model's most recent substantive synthesizing thought — when the model
 *      produced a coherent terminal response after tool execution, that text
 *      is the answer. Raw observations are evidence, not output.
 *   2. Concatenated successful non-meta tool observations — last-resort when
 *      no usable model thought exists. Marked `raw_artifacts` so the output
 *      gate knows to synthesize before user delivery.
 *   3. Empty-state sentinel — only when neither path has content.
 *
 * Filters out guard-blocked observations (success=true but warning markers)
 * by requiring the tool to be in `state.toolsUsed` and excluding known
 * guard-block text patterns.
 */
export function assembleDeliverable(state: KernelState): Deliverable {
  const lastThought = [...state.steps]
    .reverse()
    .find(
      (s) =>
        s.type === "thought" &&
        (s.content ?? "").trim().length >= MIN_MODEL_SYNTHESIS_LENGTH,
    );
  if (lastThought?.content) {
    return { content: lastThought.content, source: "model_synthesis" };
  }

  const artifacts = collectDeliverableArtifacts(state);
  if (artifacts.length > 0) {
    return { content: artifacts.join("\n\n"), source: "raw_artifacts" };
  }

  return { content: "Task complete.", source: "raw_artifacts" };
}

/**
 * Map a {@link Deliverable} to the `terminatedBy` reason that preserves its
 * source semantics across the downstream gate. Model-authored synthesis must
 * NOT trigger forced LLM re-synthesis in §9 — it's already a model output.
 */
export function deliverableTerminationReason(
  d: Deliverable,
): "harness_deliverable" | "harness_synthesis" {
  return d.source === "model_synthesis" ? "harness_synthesis" : "harness_deliverable";
}

export function collectDeliverableArtifacts(state: KernelState): string[] {
  const artifacts: string[] = [];
  for (const step of state.steps) {
    const content = getDeliverableObservationContent(state, step);
    if (content) artifacts.push(content);
  }

  return artifacts;
}

export function countDeliverableCandidates(state: KernelState): number {
  let count = 0;
  for (const step of state.steps) {
    if (getDeliverableObservationContent(state, step) !== null) count++;
  }

  return count;
}

export function getDeliverableObservationContent(
  state: KernelState,
  step: KernelState["steps"][number],
): string | null {
  if (step.type !== "observation") return null;

  const raw = (step.content ?? "").trim();
  if (raw.length === 0) return null;
  if (raw.startsWith("⚠️") || raw.includes("[Already done")) return null;

  const observationResult = step.metadata?.observationResult as
    | { success?: boolean; toolName?: string }
    | undefined;

  // Strict success gate: only observations carrying explicit `success: true`
  // metadata are eligible. Observations without metadata are dispatch-level
  // emissions — tool-name rejections, parse errors, recovery notes — and must
  // not leak into the harness deliverable. Repro: Phase-A context-stress
  // 2026-06-01 surfaced "Tool call used unavailable name(s): ..." appearing
  // as the final output for cells where the model emitted an invalid tool name
  // alongside successful tool calls. See test "assembleDeliverable rejects
  // observations without observationResult metadata".
  if (!observationResult) return null;
  if (observationResult.success !== true) return null;
  if (observationResult.toolName && RUNNER_META_TOOLS.has(observationResult.toolName)) return null;
  if (observationResult.toolName && !state.toolsUsed.has(observationResult.toolName)) return null;

  const storedKey = typeof step.metadata?.storedKey === "string" ? step.metadata.storedKey : undefined;
  return resolveStoredToolObservation(raw, state.scratchpad, storedKey);
}

export function buildEffectiveToolsUsed(state: KernelState): Set<string> {
  const effective = new Set(state.toolsUsed);
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const observationResult = step.metadata?.observationResult as {
      success?: boolean;
      delegatedToolsUsed?: readonly string[];
    } | undefined;
    if (observationResult?.success !== true || !Array.isArray(observationResult.delegatedToolsUsed)) continue;
    for (const toolName of observationResult.delegatedToolsUsed) {
      if (typeof toolName === "string" && toolName.length > 0) {
        effective.add(toolName);
      }
    }
  }
  return effective;
}
