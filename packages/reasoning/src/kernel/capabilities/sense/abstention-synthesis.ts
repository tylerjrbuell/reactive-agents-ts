// File: src/kernel/capabilities/sense/abstention-synthesis.ts
//
// GH #206: honest abstention synthesis on effort exhaustion.
//
// `resolvePassOutput()` (loop/run-pass.ts) correctly returns `null` when a run
// exhausts its iteration/tool budget without a verified answer (the HS-237 fix
// stopped a rejected continuation announcement from shipping as a false
// "answer"). But nothing filled the resulting gap: the run shipped EMPTY output
// where competing frameworks ship "I couldn't do this, here's what I tried".
//
// This module owns the deterministic (no-LLM) decision + text. It is PURE:
// reads only the run's steps. The mint that wires it
// (capabilities/sense/finalize-result.ts) owns the status/output write.
//
// Message provenance is the `budget_exhausted_no_output` sentinel (canonical
// renderer lives in @reactive-agents/core) so the text has a single source and
// can never render as a success claim.

import { deliverableToContent, sentinelDeliverable } from "@reactive-agents/core";
import type { ReasoningStep } from "../../../types/step.js";

/**
 * Terminals that are infrastructure FAULTS, not effort exhaustion. A run that
 * died because the provider/kernel errored already carries the real cause on
 * `result.error`; overwriting its empty output with a generic "ran out of
 * budget" abstention would MASK that cause. Every other non-success terminal
 * (end_turn-after-rejection, max_iterations, budget_exceeded, loop_graceful,
 * controller early-stop, …) is effort exhaustion and gets the abstention.
 */
const INFRA_FAULT_TERMINALS: ReadonlySet<string> = new Set([
  "llm_error",
  "kernel_error",
]);

/**
 * Should a non-success terminal with no output be given a synthesized
 * abstention? Pure. `undefined` (no recorded reason) counts as exhaustion:
 * the run stopped with nothing to show and no infra cause to preserve.
 */
export function shouldSynthesizeAbstention(terminatedBy: string | undefined): boolean {
  if (terminatedBy === undefined) return true;
  return !INFRA_FAULT_TERMINALS.has(terminatedBy);
}

/**
 * Deterministic "what was attempted" summary from the run's steps: how many
 * tool calls were attempted, which tools (distinct, in first-seen order), and
 * how many observations succeeded. Pure; no LLM; no state mutation.
 */
export function summarizeAttempts(steps: readonly ReasoningStep[]): string {
  let attempted = 0;
  let succeeded = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  const note = (name: string | undefined): void => {
    if (typeof name === "string" && name.length > 0 && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };

  for (const step of steps) {
    if (step.type === "action") {
      attempted += 1;
      note(step.metadata?.toolCall?.name);
    } else if (step.type === "observation") {
      if (step.metadata?.observationResult?.success === true) {
        succeeded += 1;
        note(step.metadata.observationResult.toolName);
      }
    }
  }

  if (attempted === 0) return "no tool calls were made";
  const toolPart = names.length > 0 ? ` (${names.join(", ")})` : "";
  return `${attempted} tool call(s) attempted${toolPart}, ${succeeded} succeeded`;
}

/**
 * The user-facing abstention text for an exhausted run. Routes through the
 * canonical sentinel renderer so the wording has one source of truth.
 */
export function buildAbstentionOutput(steps: readonly ReasoningStep[]): string {
  return deliverableToContent(
    sentinelDeliverable("budget_exhausted_no_output", summarizeAttempts(steps)),
  );
}
