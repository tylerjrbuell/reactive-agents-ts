/**
 * Result-boundary verification — the ONE place every run passes through.
 *
 * The terminal verifier ran only inside the react kernel. Strategy paths
 * (blueprint / plan-execute / tree-of-thought / reflexion / code-action) and
 * the engine's inline loop shipped their answers UNVERIFIED: `rax:diagnose`
 * reported "0 verifier verdicts" on every strategy trace and
 * `receipt.verifierVerdict` had no writer there (2026-07-11/12 probe fleet).
 *
 * This module runs the pure, deterministic `defaultVerifier` once at the
 * result boundary, for every path. It is an AUTHORITY-BOUNDED consumer
 * (north-star spec §3):
 *   - it NEVER upgrades anything — `verified` cannot make a bad run good;
 *   - a `reject`/`escalate` verdict CAPS the receipt verdict (mirrors the
 *     deliverable cap, e247e6b8) and names itself in `verificationWarning`;
 *   - `success` is left alone. The checks that fire here (scaffold-leak,
 *     harness-parrot, continuation-intent, fabricated-measurement) are
 *     output-quality signals; flipping success on them is a behavior change
 *     that needs its own ablation. The receipt tells the truth today.
 *
 * Pure + cheap: no LLM, no I/O — a lexical/structural pass over the run's own
 * ledger. Runs on every result, including the kernel path (idempotent: the
 * kernel's in-loop verdict governs control flow, this one governs the
 * receipt).
 */
import { Effect } from "effect";
import {
  defaultVerifier,
  emitVerifierVerdict,
  type ReasoningStep,
  type VerificationResult,
} from "@reactive-agents/reasoning";
import type { ReactiveAgentsConfig } from "../../types.js";

export interface ResultVerificationArgs {
  readonly config: ReactiveAgentsConfig;
  readonly taskId: string;
  /** The task text the user asked for. */
  readonly task: string;
  /** The answer as it will ship. */
  readonly output: string;
  /** Did the run succeed (pre-verification)? */
  readonly success: boolean;
  /** The run's full step ledger — the evidence corpus. */
  readonly steps: readonly ReasoningStep[];
  /** Tool names actually used (substantive + meta). */
  readonly toolsUsed: ReadonlySet<string>;
  /** The kernel's raw termination reason, when the path preserved one. */
  readonly terminatedBy?: string;
  /** Iteration count (for the trace event). */
  readonly iteration: number;
  /**
   * The answer was REPLAYED from the semantic cache — nothing executed. The
   * verifier declines rather than passing vacuously; see the note at the guard.
   */
  readonly replayed?: boolean;
}

export interface ResultVerificationOutcome {
  readonly result: VerificationResult;
  /** pass | warn | reject | escalate — lands on receipt.verifierVerdict. */
  readonly verdict: string;
  /** Present when the verifier rejected/escalated — the named reason. */
  readonly warning?: string;
}

/**
 * Verify the shipped answer. Returns the verdict + (on failure) the reason,
 * so the caller can stamp the receipt and the result metadata. Never throws;
 * an empty output short-circuits to `undefined` (the empty-output invariant
 * already owns that case).
 */
export const verifyResultBoundary = (
  args: ResultVerificationArgs,
): Effect.Effect<ResultVerificationOutcome | undefined, never> =>
  Effect.gen(function* () {
    if (args.output.trim().length === 0) return undefined;

    // A REPLAY IS NOT VERIFIABLE. Every check this verifier runs detects a
    // PROBLEM in the run's own record — scaffold leak, harness parrot,
    // mid-thought continuation, fabricated measurement. A semantic-cache hit
    // short-circuits the agent loop (no LLM call, no tool dispatch, no steps),
    // so the verifier finds no problem in a record that does not exist and
    // returns `pass`. That is a vacuous pass: it certifies nothing was wrong
    // with evidence it never had.
    //
    // Measured before the fix: the cache hit shipped `verifierVerdict: "pass"`
    // at confidence 0.8 while the run that actually wrote the file shipped
    // `escalate` at 0.6. A consumer gating on the verdict would accept the
    // replay and reject the grounded run. Declining leaves `verifierVerdict`
    // ABSENT, which the receipt documents as "unverified", never as "clean".
    //
    // Gated on the REPLAY signal specifically, not on `steps.length === 0`. An
    // earlier draft used the empty ledger as the proxy and broke two legitimate
    // cells: a bare-builder inline run answering from the model's own knowledge
    // also reaches this boundary with no steps, and it genuinely was verified —
    // a model did produce that answer and the lexical checks apply to it. Only
    // a run where nothing executed at all is unverifiable.
    if (args.replayed === true) return undefined;

    const result = defaultVerifier.verify({
      action: "final-answer",
      content: args.output,
      actionSuccess: args.success,
      task: args.task,
      priorSteps: args.steps,
      terminal: true,
      toolsUsed: args.toolsUsed,
      ...(args.terminatedBy !== undefined ? { terminatedBy: args.terminatedBy } : {}),
      ...(args.config.requiredTools?.tools
        ? { requiredTools: args.config.requiredTools.tools }
        : {}),
      // The user's own opt-ins ride through verbatim — this boundary does not
      // invent policy (grounding stays default-off; the fabrication guard
      // stays default-block, exactly as `.withGrounding()` /
      // `.withFabricationGuard()` declared).
      ...(args.config.grounding ? { grounding: args.config.grounding } : {}),
      ...(args.config.fabricationGuard !== undefined
        ? { fabricationGuard: args.config.fabricationGuard }
        : {}),
    });

    // Trace: this is the event that was missing from every strategy trace.
    yield* emitVerifierVerdict({
      taskId: args.taskId,
      iteration: args.iteration,
      action: "final-answer",
      terminal: true,
      verified: result.verified,
      summary: result.summary,
      checks: result.checks.map((c) => ({
        name: c.name,
        passed: c.passed,
        ...(c.reason !== undefined ? { reason: c.reason } : {}),
      })),
    });

    const verdict = result.severity ?? (result.verified ? "pass" : "reject");
    const failed = result.checks.filter((c) => !c.passed && c.reason !== undefined);
    return {
      result,
      verdict,
      ...(verdict === "reject" || verdict === "escalate"
        ? {
            warning: `Result verification ${verdict}ed: ${failed
              .map((c) => `${c.name} — ${c.reason}`)
              .join("; ")}`,
          }
        : {}),
    };
  });
