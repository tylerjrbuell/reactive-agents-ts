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
 * This module owns the PURE side of the contract: the `Deliverable` type, its
 * constructors, and `deliverableToContent`. It deliberately does NOT own the
 * state-writing step. `core` is layer 0 and cannot import `transitionState`
 * (which lives in `@reactive-agents/reasoning`'s kernel-state), so the
 * single-writer that sets `state.output` from a `Deliverable` lives in the
 * kernel (`packages/reasoning/src/kernel/loop/runner-helpers/deliverable.ts`).
 * That kernel helper is the sole place `state.output` may be written.
 *
 * @example
 *   import { modelSynthesisDeliverable, deliverableToContent } from "@reactive-agents/core";
 *
 *   const d = modelSynthesisDeliverable(lastThoughtStep);
 *   const text = deliverableToContent(d); // kernel writes this via the single-writer
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
      /**
       * The synthesizing LLM round-trip, when one occurred. OPTIONAL: the
       * harness may assemble a deliverable by concatenating already-validated
       * observation bodies with NO LLM call (the §9 M3-REWORK-compliant path).
       * When absent, the provenance is "raw concatenation, no synthesis" —
       * never fabricate a call ref to satisfy this field.
       */
      readonly synthesisCall?: LLMRoundTripRef;
      /**
       * The LLM-cleaned prose the synthesis call produced. OPTIONAL: present
       * when the harness ran a synthesizing LLM call (paired with
       * `synthesisCall`) whose output is the deliverable. When present,
       * `deliverableToContent` returns THIS, not the joined raw bodies — so a
       * harness-orchestrated synthesis is tagged truthfully as
       * `harness_synthesis` (NOT mislabeled `model_synthesis`). When absent,
       * the content is the joined `assembled` observation bodies.
       */
      readonly synthesized?: string;
    }
  | {
      readonly source: "sentinel";
      readonly reason:
        | "no_substantive_output"
        | "max_iterations_no_artifacts"
        | "awaiting_approval"
        // Durable pause (Task 9): the act capability intercepted a
        // `request_user_input` tool call and paused the run for a human
        // answer. Mirrors `awaiting_approval` exactly.
        | "awaiting_interaction"
        // O3: model honestly declined (Task 3 — model-initiated abstain path).
        | "model-abstained";
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
      return d.synthesized ?? d.assembled.map((o) => o.content).join("\n\n");
    case "sentinel":
      switch (d.reason) {
        case "max_iterations_no_artifacts":
          return "Task did not converge within the iteration budget.";
        case "awaiting_approval":
          return "Run paused — awaiting human approval.";
        case "awaiting_interaction":
          return "Run paused — awaiting human input.";
        default:
          return "Task complete.";
      }
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
 * Construct a `tool_artifact` deliverable from a single validated observation.
 * Used when one successful tool result IS the answer (e.g., a `final-answer`
 * tool call, or a read whose body is the deliverable).
 */
export function toolArtifactDeliverable(observation: ValidatedObservation): Deliverable {
  return { source: "tool_artifact", observation };
}

/**
 * Construct a `harness_synthesis` deliverable: the harness assembled the answer
 * from validated observations, optionally via a synthesizing LLM call.
 *
 * Pass `synthesized` (the LLM-cleaned prose) + `synthesisCall` when an LLM
 * synthesis ran — `deliverableToContent` then returns the cleaned prose and the
 * source is truthfully `harness_synthesis` (the S11 fix: harness-orchestrated
 * synthesis must NOT be mislabeled `model_synthesis`). Omit both for the
 * raw-concatenation (no-LLM) path.
 */
export function harnessSynthesisDeliverable(
  assembled: readonly ValidatedObservation[],
  synthesisCall?: LLMRoundTripRef,
  synthesized?: string,
): Deliverable {
  return {
    source: "harness_synthesis",
    assembled,
    ...(synthesisCall ? { synthesisCall } : {}),
    ...(synthesized !== undefined ? { synthesized } : {}),
  };
}

/**
 * Construct a sentinel deliverable. Used when the harness terminates without
 * substantive output (e.g., max-iterations exhausted with no tool artifacts,
 * or the model/harness abstained because grounding was impossible).
 */
export function sentinelDeliverable(
  reason:
    | "no_substantive_output"
    | "max_iterations_no_artifacts"
    | "awaiting_approval"
    | "awaiting_interaction"
    | "model-abstained",
): Deliverable {
  return { source: "sentinel", reason };
}
