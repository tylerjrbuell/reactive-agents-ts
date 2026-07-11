// File: src/types/step.ts
import { Schema } from "effect";
import { ObservationResultSchema } from "./observation.js";

// ─── Step ID (branded string) ───

export const StepId = Schema.String.pipe(Schema.brand("StepId"));
export type StepId = typeof StepId.Type;

// ─── Step Type ───

export const StepType = Schema.Literal(
  "thought", // Thinking/reasoning
  "action", // Tool call
  "observation", // Tool result (real data from a tool execution)
  "harness_signal", // Harness-injected signal (recovery nudge, guard message, dispatcher status) — NOT model-produced data; never assembled into a deliverable
  "plan", // Planning step
  "reflection", // Self-reflection
  "critique", // Self-critique
);
export type StepType = typeof StepType.Type;

/**
 * Type predicate: is this step real model/tool output the user might see in
 * the final answer? Excludes harness-injected signals like recovery nudges,
 * guard messages, and dispatcher status updates that are routed through
 * step storage purely so think-phase prompt construction can read them.
 *
 * The deliverable assembler and the evidence-grounding corpus MUST filter
 * via this predicate. Without it, harness control strings leak into
 * user-visible output (e.g. "Task incomplete — missing_required_tool: ...").
 */
export const isUserVisibleStep = (s: { type: string }): boolean =>
  s.type !== "harness_signal";

// ─── Step Metadata ───

export const StepMetadataSchema = Schema.Struct({
  confidence: Schema.optional(Schema.Number),
  toolUsed: Schema.optional(Schema.String),
  cost: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  observationResult: Schema.optional(ObservationResultSchema),
  /** Internal reasoning from thinking models (e.g. <think> blocks) */
  thinking: Schema.optional(Schema.String),
  /** Structured tool call data from native function calling */
  toolCall: Schema.optional(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  })),
  /** Scratchpad key for auto-stored compressed tool results */
  storedKey: Schema.optional(Schema.String),
  /** Links an observation step back to its originating tool call for parallel batch matching */
  toolCallId: Schema.optional(Schema.String),
  /** Distilled key fact extracted from raw tool results — surfaced in the system prompt Prior work section */
  extractedFact: Schema.optional(Schema.String),
  /**
   * Sprint 3.2 — Verifier output for this step. Attached by act.ts after
   * every effector output via defaultVerifier.verify(). Read by Arbitrator
   * (S3.3) and Reflection (S3.4) to make decisions consistent with
   * verification verdicts. Untyped here to avoid a cyclic schema import;
   * runtime callers cast to VerificationResult from
   * @reactive-agents/reasoning.
   */
  verification: Schema.optional(Schema.Unknown),
  /**
   * HS-cleanup-1 (2026-05-23) — framework instrumentation tag.
   *
   * When set, marks the step as framework-emitted scaffolding (control
   * markers like `[CRITIQUE N]`, `[TOT depth=2]`, tool-result compressed-
   * preview wrappers) that is INTERNAL to the reasoning machinery — not a
   * candidate for user-facing output. Output assembly + arbitrator skip
   * these steps when picking a final answer; verifier rejects any output
   * whose text matches a known instrumentation pattern as a producer-side
   * regression signal.
   *
   * Value is a short kind tag (`"critique-marker" | "tot-marker" | "tool-preview"`)
   * for telemetry and pattern attribution. Absence implies the step is
   * user-facing-eligible.
   */
  frameworkInstrumentation: Schema.optional(Schema.String),
  /**
   * Spec §5b — a harness intervention recorded on the step that carried it
   * (gate redirect, recovery nudge, guard fire, strategy switch, the piece-1
   * lexical-proposal rejection). Aggregated onto `result.receipt.interventions[]`
   * so callers can see WHAT the harness did to the run and under WHICH authority
   * class. Absence implies the step is not a control-plane intervention.
   */
  intervention: Schema.optional(
    Schema.Struct({
      /** Actor that produced the intervention (evaluator/gate/guard name). */
      actor: Schema.String,
      /** Authority class of the actor (spec §3). */
      authorityClass: Schema.Literal("deterministic", "model-grade", "lexical"),
      /** Short evidence string naming the concrete signal. */
      evidence: Schema.String,
      /** What the intervention changed about the run. */
      whatChanged: Schema.String,
      /** Run iteration at which it fired. */
      iter: Schema.Number,
    }),
  ),
});
export type StepMetadata = typeof StepMetadataSchema.Type;

// ─── Reasoning Step ───

export const ReasoningStepSchema = Schema.Struct({
  id: StepId,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(StepMetadataSchema),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;
