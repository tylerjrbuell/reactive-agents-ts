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
  let observed = 0;
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
      if (step.metadata?.observationResult !== undefined) observed += 1;
      if (step.metadata?.observationResult?.success === true) {
        succeeded += 1;
        note(step.metadata.observationResult.toolName);
      }
    }
  }

  // Steps carried across a strategy switch can hold a tool observation whose
  // action step was dropped; a call that produced an observation was attempted,
  // so `attempted` is never below the observed count (succeeded <= attempted).
  attempted = Math.max(attempted, observed);
  if (attempted === 0) return "no tool calls were made";
  const toolPart = names.length > 0 ? ` (${names.join(", ")})` : "";
  return `${attempted} tool call(s) attempted${toolPart}, ${succeeded} succeeded`;
}

/**
 * Raw terminals that are a GUARD stopping the run before its budget ran out
 * (loop resolution, low-delta, oracle force, strategy-switch exhaustion, the
 * controller / dispatcher early-stops, the unresolved-tool-call protocol stop).
 * Saying "within the available budget" for these is false: a cogito run that
 * looped on `brief` was told its budget ran out at iteration 4 of 16 (K2,
 * 2026-11-04). An explicit list: a miss keeps the legacy budget wording.
 * `low_delta_guard` is deliberately absent for now: the runtime #206 e2e pin
 * (`abstention-synthesis-206.test.ts`, long-horizon arm) expects the budget
 * wording on a run that ends on that guard; moving it is a runtime-side call.
 */
const GUARD_STOP_TERMINALS: ReadonlySet<string> = new Set([
  "loop_graceful",
  "loop_detected_with_veto",
  "oracle_forced",
  "switching_exhausted",
  "dispatcher-early-stop",
  "controller_signal_veto",
  "controller_early_stop_ungrounded",
  "tool_call_unresolved",
]);

/** True when `terminatedBy` names a guard stop rather than budget exhaustion. */
export function isGuardStopTerminal(terminatedBy: string | undefined): boolean {
  if (terminatedBy === undefined) return false;
  return (
    GUARD_STOP_TERMINALS.has(terminatedBy) ||
    terminatedBy.startsWith("loop_detected:") ||
    terminatedBy.startsWith("controller_early_stop:")
  );
}

/** What stopped the run, when the caller knows it (raw terminatedBy + the run's error). */
export interface AbstentionStop {
  readonly terminatedBy?: string;
  readonly error?: string | null;
}

/**
 * The user-facing abstention text for a run that stopped with no output.
 * Routes through the canonical sentinel renderer so the wording has one source
 * of truth. A guard stop names the guard and its own diagnostic (first line of
 * the run's error); every other terminal keeps the budget wording.
 */
export function buildAbstentionOutput(
  steps: readonly ReasoningStep[],
  stop?: AbstentionStop,
): string {
  const attempts = summarizeAttempts(steps);
  if (isGuardStopTerminal(stop?.terminatedBy)) {
    const why = (stop?.error ?? "").split("\n")[0]?.trim() ?? "";
    const cause = `the run was stopped by ${stop?.terminatedBy}${why.length > 0 ? ` (${why.replace(/\.$/, "")})` : ""}; ${attempts}`;
    return deliverableToContent(sentinelDeliverable("no_substantive_output", cause));
  }
  return deliverableToContent(sentinelDeliverable("budget_exhausted_no_output", attempts));
}
