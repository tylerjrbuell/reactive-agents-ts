/**
 * runner-helpers/deliverable.ts — Harness-owned deliverable assembly.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. The runner ships a
 * source-tagged {@link Deliverable} at termination. As of P1 mission 2A
 * (2026-06-03) the TYPE is the canonical 4-source contract owned by
 * `@reactive-agents/core` (`Deliverable` + its constructors); this file owns
 * only the kernel-side ASSEMBLY (which steps earn a place) and the single
 * state-writer ({@link commitDeliverable}). `runner.ts` re-exports
 * `assembleDeliverable` so external callers (e.g. `output-quality-gate.test.ts`)
 * continue importing from `kernel/loop/runner.js`; it re-exports the
 * `Deliverable` TYPE from `@reactive-agents/core`.
 *
 * Priority order is a load-bearing contract (see assembleDeliverable JSDoc):
 *   1. model-authored synthesizing thought → model_synthesis (no forced LLM
 *      re-synthesis — M3 REWORK precedent)
 *   2. exactly one validated tool observation → tool_artifact
 *   3. multiple validated tool observations → harness_synthesis (concatenated)
 *   4. empty-state → sentinel
 */

import {
  type KernelState,
  transitionState,
} from "../../../kernel/state/kernel-state.js";
import { META_TOOLS as RUNNER_META_TOOLS } from "../../../kernel/state/kernel-constants.js";
import {
  type Deliverable,
  type ValidatedObservation,
  deliverableToContent,
  modelSynthesisDeliverable,
  toolArtifactDeliverable,
  harnessSynthesisDeliverable,
  sentinelDeliverable,
} from "@reactive-agents/core";
import type { TerminateReason } from "../terminate.js";
import { resolveStoredToolObservation } from "./state-queries.js";

/** Minimum thought length to be treated as a model-authored final synthesis. */
export const MIN_MODEL_SYNTHESIS_LENGTH = 100;

/**
 * Sentinel `synthesisCall` ref for the harness-concat path. This assembly does
 * NO LLM call (M3 REWORK forbids parent-side re-synthesis) — it concatenates
 * already-validated observation bodies. `harnessSynthesisDeliverable` requires
 * an `LLMRoundTripRef`, so we stamp an explicit no-synthesis marker rather than
 * fabricate a real call id. `deliverableToContent` never reads this field; it
 * exists only as provenance. See P1 mission 2A UpwardReport (flagged wart).
 */
const NO_SYNTHESIS_CALL = { callId: "harness-concat-no-synthesis" } as const;

/**
 * Build a {@link ValidatedObservation} from a resolved artifact body.
 *
 * Eligibility was already enforced by {@link getDeliverableObservationContent}
 * (success === true AND tool in `state.toolsUsed`), so the `invariant` is
 * structurally true here. The step carries no `callId` (kernel observation
 * steps don't store one), so we stamp a synthesized marker — provenance only;
 * `deliverableToContent` reads only `.content`.
 */
function toValidatedObservation(toolName: string, content: string): ValidatedObservation {
  return {
    _validated: "tool-success",
    toolName,
    callId: `harness-obs:${toolName}`,
    content,
    invariant: { success: true, toolInState: true },
  };
}

/**
 * Assemble the harness-owned deliverable as a core 4-source {@link Deliverable}.
 *
 * Priority order (design contract):
 *   1. Model's most recent substantive synthesizing thought (>= MIN_MODEL_
 *      SYNTHESIS_LENGTH chars) → `model_synthesis`. When the model produced a
 *      coherent terminal response after tool execution, that text is the
 *      answer; raw observations are evidence, not output.
 *   2. Exactly one validated non-meta tool observation → `tool_artifact`.
 *   3. Multiple validated observations → `harness_synthesis` (their bodies
 *      concatenated; no LLM synthesis call — see NO_SYNTHESIS_CALL).
 *   4. No usable thought or artifact → `sentinel` ("no_substantive_output").
 *
 * Filters out guard-blocked observations (success=true but warning markers)
 * by requiring the tool to be in `state.toolsUsed` and excluding known
 * guard-block text patterns (see getDeliverableObservationContent).
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
    return modelSynthesisDeliverable({
      type: "thought",
      content: lastThought.content,
      iteration: state.iteration,
    });
  }

  const observations = collectValidatedObservations(state);
  if (observations.length === 1) {
    return toolArtifactDeliverable(observations[0]!);
  }
  if (observations.length > 1) {
    return harnessSynthesisDeliverable(observations, NO_SYNTHESIS_CALL);
  }

  return sentinelDeliverable("no_substantive_output");
}

/**
 * The SINGLE writer of `state.output` for the harness-assembly paths. Sets
 * `output = deliverableToContent(d)` via `transitionState`.
 *
 * Provenance is carried by the `terminatedBy` reason (see
 * {@link deliverableTerminationReason}), which the post-loop promotion stamps.
 * A dedicated typed `meta.deliverableSource` field was intentionally NOT added
 * here: that requires editing `kernel-state.ts`, which is P1 mission 2B
 * territory (and outside this mission's authority paths).
 *
 * Callers that also need to set `terminatedBy`/`previousTerminatedBy` (the
 * post-loop promotion at runner.ts:501) pass them via `extraMeta`; callers
 * that already own `terminatedBy` (the runner.ts:524 fallback) pass nothing so
 * their reason is never clobbered.
 *
 * NOTE: this is NOT yet the kernel-wide single writer — the `terminate()`-based
 * paths (stall-deliverable.ts, loop-resolution.ts) still write output through
 * `terminate()`. Routing those is P1 mission 2B. This writer owns the two
 * direct-`transitionState({output})` paths in runner.ts.
 */
export function commitDeliverable(
  state: KernelState,
  d: Deliverable,
  extraMeta?: Partial<KernelState["meta"]>,
): KernelState {
  return transitionState(state, {
    output: deliverableToContent(d),
    ...(extraMeta ? { meta: { ...state.meta, ...extraMeta } } : {}),
  });
}

/**
 * Map a {@link Deliverable} to the `terminatedBy` reason that preserves its
 * source semantics across the downstream gate.
 *
 * Only `model_synthesis` maps to `harness_synthesis` (the model authored it —
 * it must NOT trigger forced LLM re-synthesis in §9). Everything that was the
 * single evidence-source in the legacy 2-source type — now split into
 * `tool_artifact`, `harness_synthesis`, and `sentinel` SOURCES — maps to
 * `harness_deliverable`.
 *
 * ⚠️ NAMING COLLISION: the SOURCE `harness_synthesis` maps to the terminatedBy
 * `harness_deliverable`, NOT to terminatedBy `harness_synthesis`. The SOURCE
 * means "harness concatenated multiple observations"; the terminatedBy
 * `harness_synthesis` means "model authored the answer". Do not "fix" this into
 * a bug. (P1 mission 2A; preserves test 235/285/310/339 + not-235 at 254.)
 */
export function deliverableTerminationReason(
  d: Deliverable,
): Extract<TerminateReason, "harness_deliverable" | "harness_synthesis"> {
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

/**
 * Collect validated tool observations as {@link ValidatedObservation}s, in
 * step order. Each carries its RESOLVED content (post STORED/recall scratchpad
 * resolution) so `deliverableToContent` reproduces the same body the legacy
 * `collectDeliverableArtifacts` produced — preserving the STORED/recall tests.
 */
function collectValidatedObservations(state: KernelState): ValidatedObservation[] {
  const out: ValidatedObservation[] = [];
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const content = getDeliverableObservationContent(state, step);
    if (content === null) continue;
    const toolName =
      (step.metadata?.observationResult as { toolName?: string } | undefined)?.toolName ??
      "unknown";
    out.push(toValidatedObservation(toolName, content));
  }
  return out;
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
