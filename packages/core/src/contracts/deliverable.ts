/**
 * DeliverableProvenance — typed channel into `state.output`.
 *
 * `state.output: string | null` accepts anything from anywhere — that loose
 * typing was the structural cause of three "errors leaked into output" bugs in
 * three months. The fix is to make `state.output` settable ONLY through a
 * typed value (`Deliverable`) whose construction proves the provenance.
 *
 * Companion spec: [[2026-06-02-canonical-contracts-and-invariants]] §2.3.
 * Second contract in the Sprint-1 typed-contract foundation (north-star §6.5).
 *
 * Phase-A 2026-06-02 evidence: dispatch-rejection observations leaking as
 * `state.output` were filtered at runtime in `deliverable.ts:120` (strict
 * `observationResult.success === true` gate). That patch fixed the symptom.
 * This module makes the SAME guarantee structural: an observation without
 * `_validated: "tool-success"` cannot be widened to a `Deliverable`, so the
 * leak class becomes impossible to construct.
 *
 * @example
 *   import { commitDeliverable, type Deliverable } from "@reactive-agents/core";
 *
 *   const d: Deliverable = {
 *     source: "model_synthesis",
 *     thought: lastThoughtStep,
 *     chars: lastThoughtStep.content.length,
 *   };
 *   const next = commitDeliverable(state, d);
 */

/**
 * A thought step the model authored. Mirrors the minimal shape kernel-state
 * uses for thoughts; carried by reference, not copied.
 */
export interface ThoughtStepRef {
  readonly type: "thought";
  readonly content: string;
  readonly iteration: number;
}

/**
 * A reference to an LLM round-trip that produced a synthesis. Used to trace
 * harness-authored synthesis back to its source call.
 */
export interface LLMRoundTripRef {
  readonly callId: string;
}

/**
 * The invariant a tool observation MUST satisfy to qualify as a deliverable.
 * Constructed only by the tool-dispatch happy path: success === true AND the
 * tool appears in `state.toolsUsed`. Dispatch rejections (unavailable name,
 * arg validation failure) cannot satisfy this shape — the leak class is
 * eliminated at the type level.
 */
export interface ValidatedObservation {
  readonly _validated: "tool-success";
  readonly toolName: string;
  readonly callId: string;
  readonly content: string;
  readonly invariant: {
    readonly success: true;
    readonly toolInState: true;
  };
}

/**
 * Discriminated union of all valid deliverable provenances.
 *
 *  - `model_synthesis` — a substantive trailing thought the model authored.
 *    The content IS the answer; raw tool observations are the evidence.
 *  - `tool_artifact` — a single validated tool observation that is the
 *    answer (e.g. a `final-answer` tool call, a successful read whose body
 *    is the deliverable).
 *  - `harness_synthesis` — the harness assembled the answer from multiple
 *    validated observations + a synthesizing LLM call.
 *  - `sentinel` — no substantive output to commit; the harness emits a
 *    structured marker (NOT a string) so downstream can render appropriately.
 */
export type Deliverable =
  | {
      readonly source: "model_synthesis";
      readonly thought: ThoughtStepRef;
      readonly chars: number;
    }
  | {
      readonly source: "tool_artifact";
      readonly observation: ValidatedObservation;
    }
  | {
      readonly source: "harness_synthesis";
      readonly assembled: readonly ValidatedObservation[];
      readonly synthesisCall: LLMRoundTripRef;
    }
  | {
      readonly source: "sentinel";
      readonly reason: "no_substantive_output" | "max_iterations_no_artifacts";
    };

/**
 * Resolve a `Deliverable` to the user-facing output string.
 *
 * The single content-extraction function. All renderers (LLM output sink,
 * verifier, bench scorer) go through this — no string-side conversions
 * scattered across call sites.
 */
export function deliverableToContent(d: Deliverable): string {
  switch (d.source) {
    case "model_synthesis":
      return d.thought.content;
    case "tool_artifact":
      return d.observation.content;
    case "harness_synthesis":
      return d.assembled.map((o) => o.content).join("\n\n");
    case "sentinel":
      return d.reason === "max_iterations_no_artifacts"
        ? "Task did not converge within the iteration budget."
        : "Task complete.";
  }
}

/**
 * Construct a `model_synthesis` deliverable from a thought step. The runner
 * fallback path (`runner.ts:530`) writes the last substantive thought into
 * `state.output` when no validated tool artifact exists.
 */
export function modelSynthesisDeliverable(thought: ThoughtStepRef): Deliverable {
  return { source: "model_synthesis", thought, chars: thought.content.length };
}

/**
 * Construct a sentinel deliverable. Used when the harness terminates without
 * substantive output (e.g., max-iterations exhausted with no tool artifacts).
 */
export function sentinelDeliverable(
  reason: "no_substantive_output" | "max_iterations_no_artifacts",
): Deliverable {
  return { source: "sentinel", reason };
}
