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
import { artifacts } from "../../ledger/artifact-projection.js";
import { verifyDelivery } from "../../capabilities/verify/delivery-authority.js";
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
import type { TerminateReason } from "../terminate-reason.js";
import { resolveStoredToolObservation } from "./state-queries.js";
import {
  findUnconsumedStoredKeys,
  resolveUnconsumedEvidence,
} from "../../capabilities/verify/unconsumed-evidence.js";

/** Collapse whitespace runs so verbatim-content comparison survives markdown
 * line-ending / spacing differences between how content was stored and how
 * the model reproduced it in its thought. */
function normalizeForContainment(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Minimum thought length to be treated as a model-authored final synthesis. */
export const MIN_MODEL_SYNTHESIS_LENGTH = 100;

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
 *      concatenated; no LLM synthesis call — synthesisCall is omitted).
 *   4. No usable thought or artifact → `sentinel` ("no_substantive_output").
 *
 * Filters out guard-blocked observations (success=true but warning markers)
 * by requiring the tool to be in `state.toolsUsed` and excluding known
 * guard-block text patterns (see getDeliverableObservationContent).
 */
export function assembleDeliverable(state: KernelState): Deliverable {
  // 2026-08-15 root fix: a long model thought is not evidence it read the
  // full tool output — small models routinely write a plausible-sounding
  // synthesis off a compressed preview alone. Bare thought text is never
  // grounded against `state.scratchpad`, so trusting it whenever unconsumed
  // stored evidence still exists (and there's grounded content to fall back
  // to) reproduces the same fabrication this run fixed at every other
  // termination path. Fall through to the deterministically-resolved
  // observations (tool_artifact/harness_synthesis, already scratchpad-resolved
  // by getDeliverableObservationContent) instead. Computed lazily — only the
  // (common) case where a thought exists needs this check at all.
  //
  // 2026-08-16 root fix (t0-deterministic `cs-overflow-transcribe` regression):
  // "unconsumed" is a bookkeeping fact (no `recall()` call was made), not a
  // grounding fact — a thought can correctly transcribe stored evidence
  // without the harness ever seeing a `recall`. The prior binary check
  // discarded a thought that DID contain the full evidence verbatim (e.g. a
  // transcribed table including its tail sentinel) in favor of the raw stored
  // observation, which can itself be compressed/truncated on the stored path
  // — losing content the thought actually had. Only override when the thought
  // does NOT already contain the unconsumed evidence's content; a thought
  // that demonstrably reproduces the evidence is grounded regardless of
  // whether `recall()` was called.
  const hasUnconsumedEvidence = findUnconsumedStoredKeys(state.steps).length > 0;

  const lastThought = [...state.steps]
    .reverse()
    .find(
      (s) =>
        s.type === "thought" &&
        (s.content ?? "").trim().length >= MIN_MODEL_SYNTHESIS_LENGTH,
    );

  const thoughtGroundsUnconsumedEvidence = (() => {
    if (!hasUnconsumedEvidence || !lastThought?.content) return false;
    const evidence = resolveUnconsumedEvidence(state.steps, state.scratchpad);
    if (!evidence) return false;
    return normalizeForContainment(lastThought.content).includes(
      normalizeForContainment(evidence),
    );
  })();

  if (
    lastThought?.content &&
    !(
      hasUnconsumedEvidence &&
      countDeliverableCandidates(state) > 0 &&
      !thoughtGroundsUnconsumedEvidence
    )
  ) {
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
    // No LLM synthesis call (M3 REWORK forbids parent-side re-synthesis) — the
    // harness concatenates already-validated observation bodies. As of core
    // e4abf43e the `synthesisCall` ref is OPTIONAL, so we pass none rather than
    // fabricate a marker. `deliverableToContent` joins the bodies directly.
    return harnessSynthesisDeliverable(observations);
  }

  return sentinelDeliverable("no_substantive_output");
}

/**
 * Wrap an already-resolved output string (or null) as a {@link Deliverable} for
 * the passthrough termination paths (low_delta_guard, switching_exhausted,
 * stop-checkpoint, bootstrap/before-think abort-with-done). At these sites
 * `state.output` holds whatever a PRIOR committed path produced — model text,
 * an assembled artifact body, or nothing.
 *
 * Mapping (P1 mission 2B):
 *   - any string (incl. empty) / null → `model_synthesis` passthrough whose
 *     content is `output ?? ""`. `deliverableToContent` then returns the string
 *     verbatim — for an empty/null input it returns `""` (FALSY), exactly
 *     reproducing the legacy `output: state.output ?? ""` write.
 *
 * ⚠️ Do NOT map empty → `sentinelDeliverable`: `deliverableToContent(sentinel)`
 * returns the TRUTHY phrase "Task complete.", which would (a) skip the
 * `status==="done" && !state.output` lastThought fallback at runner.ts:535 and
 * (b) trip the truthy-output verifier/quality gates at runner.ts:591/680 on a
 * parrot phrase — flipping a previously-successful low_delta/switching_exhausted
 * termination to failed/empty. The empty model_synthesis preserves the falsy
 * sentinel-free behavior the downstream gates depend on. (Surfaced in the 2B
 * UpwardReport: the brief's "sentinel for empty" did not account for these
 * truthiness gates; `sentinel` is correct only at genuinely-terminal sites with
 * NO downstream lastThought fallback — which the runner already uses directly,
 * e.g. the stop-checkpoint path before this routing.)
 */
export function passthroughOutputDeliverable(output: string | null): Deliverable {
  return modelSynthesisDeliverable({
    type: "thought",
    content: output ?? "",
    iteration: 0,
  });
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
 * A deliverable whose content was ALREADY authored as final prose must NOT
 * trigger forced LLM re-synthesis at the §9 output gate. Two sources qualify:
 *   - `model_synthesis` — the MODEL authored the trailing thought; the text IS
 *     the answer.
 *   - `harness_synthesis` carrying a `synthesized` field — the HARNESS ran a
 *     synthesizing LLM call whose cleaned prose is the answer (Drift S11). At
 *     the synthesis-gate this preserves the exact terminatedBy the legacy
 *     `model_synthesis` write produced — re-synthesizing already-clean prose is
 *     a regression.
 * Both map to terminatedBy `harness_synthesis` ("already final, do not
 * re-synthesize").
 *
 * Everything else maps to `harness_deliverable` (the attempt-synthesis path):
 *   - `harness_synthesis` WITHOUT `synthesized` — raw concatenation of
 *     validated observation bodies (no LLM call); raw artifacts still warrant a
 *     formatting pass.
 *   - `tool_artifact`, `sentinel`.
 *
 * ⚠️ NAMING COLLISION: a `harness_synthesis` SOURCE may map to EITHER
 * terminatedBy depending on whether `synthesized` is set — the terminatedBy
 * `harness_synthesis` means "already final prose, do not re-synthesize" (model
 * thought OR harness-cleaned prose), NOT "the harness concatenated
 * observations". Do not "fix" this into a single-branch mapping. (P1 mission 2A
 * + Drift S11; preserves output-quality-gate tests 236/286/311/340 + not-255.)
 */
export function deliverableTerminationReason(
  d: Deliverable,
): Extract<TerminateReason, "harness_deliverable" | "harness_synthesis"> {
  if (d.source === "model_synthesis") return "harness_synthesis";
  if (d.source === "harness_synthesis" && d.synthesized !== undefined) {
    return "harness_synthesis";
  }
  return "harness_deliverable";
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

/**
 * Count REAL file artifacts produced this run — the tool-declared `artifact`
 * ledger entries (Wave C / C2, audit 01-F1), NOT "any successful observation".
 * This is the deliverable-truth signal the old `countDeliverableCandidates`
 * conflated with evidence (5 web-searches counted as "5 artifacts").
 *
 * Consumers that must distinguish "produced a file" from "gathered evidence"
 * read THIS; consumers that need substantive-output-of-any-kind (deliverable
 * assembly for research answers) keep reading `countDeliverableCandidates` so
 * non-artifact tasks stay sane. Empty ledger / no artifacts → 0.
 */
export function countArtifacts(state: KernelState): number {
  return artifacts(state.ledger).length;
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

/**
 * The run contract's declared FILE deliverables that have not been produced yet.
 *
 * Read by the diminishing-returns guards before they terminate a run early. The
 * guards already refuse to fire while a REQUIRED TOOL is still uncalled; a
 * declared deliverable is the same class of "the run is not done" fact, and is
 * the one the contract exists to state — but nothing consulted it, so a guard
 * could end a run whose whole point was to write a file it had not written.
 *
 * Live witness (bench rw-4, 2026-07-26): the agent fetched the posts, fetched
 * the comments, and computed the enriched 10-element array — four successful
 * tool calls — and `low_delta_guard` terminated it at iteration 3 on
 * `tokenDelta: 0` with `artifactsAvailable: 4`, before it ever wrote the
 * required `output.ts`. The task then scored 0: "output.ts exports no array".
 * The model had done the work; the harness ended the run one step early.
 *
 * Judged with the SAME `verify()` gate the terminal gate and the receipt use —
 * including the run-scoped ledger, so a deliverable produced by a SUB-AGENT
 * counts. Pure: no fs, no LLM. Empty (so guards behave exactly as before) when
 * the run compiled no contract or the contract declares no file deliverables.
 */
export function unproducedDeliverables(state: KernelState): readonly string[] {
  const declared = state.meta.runContract?.deliverables ?? [];
  const out: string[] = [];
  for (const d of declared) {
    if (d.matcher.kind !== "ArtifactProduced") continue;
    const { unmet } = verifyDelivery([d.matcher], {
      steps: state.steps,
      output: state.output ?? "",
      ledger: state.ledger,
    });
    if (unmet.length > 0) out.push(d.matcher.path);
  }
  return out;
}
