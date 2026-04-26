// File: src/kernel/capabilities/verify/verifier.ts
//
// Verifier — first-class capability for the Verify concern (North Star v3.0
// §3.1 capability #8). Promoted to a single-owner service in Sprint 3.2.
//
// Why a port:
//   - Pre-Sprint-3.2, "did the action succeed?" was answered in scattered
//     places: the tool's own success boolean, isSatisfied() in quality-utils,
//     evidence-grounding scattered in act.ts, requirement-state checks
//     elsewhere. No single place could answer "what did the verifier decide
//     about this action's outcome?"
//   - The Verifier reifies that single answer. Every effector output passes
//     through verify(); the structured VerificationResult is stored on the
//     observation step's metadata and emitted as a TraceEvent so downstream
//     consumers (Arbitrator in S3.3, Reflection in S3.4, Learning in S3.5)
//     all consult the same signal.
//
// Lifecycle:
//   - Pure function. No side effects. No state mutation.
//   - Runs ONCE per effector output (every tool execution, every meta-tool
//     invocation, every final-answer attempt).
//   - act.ts wires the call; the Verifier doesn't drive the loop.
//
// What this is NOT:
//   - Not a strategy switcher (Decide owns that)
//   - Not a termination authority (Decide owns that — the Arbitrator)
//   - Not a memory writer (Learn owns that)
//   - Just: did the action achieve its purpose? Pass/fail with reasons.

import type { ReasoningStep } from "../../../types/index.js";
import type { ObservationResult } from "../../../types/observation.js";
import { isSatisfied } from "./quality-utils.js";
import {
  buildEvidenceCorpusFromSteps,
  validateOutputGroundedInEvidence,
} from "./evidence-grounding.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Inputs the Verifier consults when evaluating an action's outcome.
 *
 * Kept as flat, structured data so the Verifier remains a pure function:
 * given the same context, it returns the same VerificationResult.
 */
export interface VerificationContext {
  /** Tool name or action verb that just executed. */
  readonly action: string;
  /** Result content from the action (tool output, LLM answer, etc.). */
  readonly content: string;
  /** Action's own success signal — usually from the tool handler. */
  readonly actionSuccess: boolean;
  /** Original task description — used for grounding + completion checks. */
  readonly task: string;
  /** Steps prior to this verification — used for evidence corpus. */
  readonly priorSteps: readonly ReasoningStep[];
  /** Required tools the harness expects to be called before completion. */
  readonly requiredTools?: readonly string[];
  /** Tools called so far this run. */
  readonly toolsUsed?: ReadonlySet<string>;
  /**
   * When true, the action represents a terminal output (final answer,
   * task-complete, etc.) and the Verifier should run completion + grounding
   * checks. Otherwise, only the action-level checks run.
   */
  readonly terminal?: boolean;
}

/**
 * One named check the Verifier ran with its outcome and reason.
 *
 * Checks are listed in order — gate scenarios + reflection consumers can
 * scan the list to find the first failed check (the "lead" reason for
 * verification failure).
 */
export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
}

/**
 * The Verifier's structured verdict on a single action's outcome.
 *
 * `verified === true` only when ALL checks pass. A single failed check
 * flips the overall verdict to false, and the failed check's name +
 * reason populate `summary`.
 */
export interface VerificationResult {
  readonly verified: boolean;
  readonly checks: readonly VerificationCheck[];
  readonly summary: string;
  /**
   * The action this result describes. Forwarded for telemetry / trace
   * consumers that need to correlate verifications with actions.
   */
  readonly action: string;
}

/**
 * The Verifier port. Production injects {@link defaultVerifier}; tests
 * can swap in fakes to assert wiring (e.g., that act.ts always calls
 * verify() after every effector output).
 */
export interface Verifier {
  verify(ctx: VerificationContext): VerificationResult;
}

// ─── Default implementation ───────────────────────────────────────────────────

/**
 * Helper — returns the first failing check's reason, or "all checks passed".
 */
function buildSummary(action: string, checks: readonly VerificationCheck[]): string {
  const firstFailed = checks.find((c) => !c.passed);
  if (firstFailed) {
    return `${action}: failed at ${firstFailed.name}${firstFailed.reason ? ` (${firstFailed.reason})` : ""}`;
  }
  return `${action}: ${checks.length} check${checks.length === 1 ? "" : "s"} passed`;
}

/**
 * Default Verifier — wraps the existing quality / evidence / requirement
 * helpers under a single typed contract. Behavior is intentionally
 * conservative: today's checks are the same as today's scattered checks,
 * just routed through one entry point. Future sprints can add new checks
 * (per-tier thresholds, learned heuristics, model-specific gates) without
 * touching the call sites.
 *
 * Check order matters — earlier checks gate later ones via short-circuit
 * semantics (if action-level fails, terminal-only checks are skipped).
 */
export const defaultVerifier: Verifier = {
  verify(ctx: VerificationContext): VerificationResult {
    const checks: VerificationCheck[] = [];

    // ── Check 1: action-success ──────────────────────────────────────────────
    // The tool handler's own success signal. Almost every other check is
    // moot if the action itself errored.
    checks.push({
      name: "action-success",
      passed: ctx.actionSuccess,
      reason: ctx.actionSuccess
        ? undefined
        : `${ctx.action} returned success=false`,
    });

    // ── Check 2: non-empty-content ───────────────────────────────────────────
    // An action that succeeded but produced zero bytes is suspicious.
    // Flag it without failing — empty output is a verifier signal, not
    // necessarily a failure (e.g., a delete tool legitimately returns "").
    const hasContent = ctx.content.trim().length > 0;
    checks.push({
      name: "non-empty-content",
      passed: hasContent,
      reason: hasContent ? undefined : "action returned empty content",
    });

    // ── Terminal-only checks ─────────────────────────────────────────────────
    // Skip these for non-terminal actions. They're expensive and only
    // meaningful when evaluating a candidate final answer.
    if (ctx.terminal && ctx.actionSuccess && hasContent) {
      // Check 3: required-tools-satisfied
      if (ctx.requiredTools && ctx.requiredTools.length > 0) {
        const used = ctx.toolsUsed ?? new Set<string>();
        const missing = ctx.requiredTools.filter((t) => !used.has(t));
        checks.push({
          name: "required-tools-satisfied",
          passed: missing.length === 0,
          reason:
            missing.length > 0
              ? `missing required tools: ${missing.join(", ")}`
              : undefined,
        });
      }

      // Check 4: completion-claim
      // If the model's content includes "satisfied" / completion language,
      // record that as a positive signal. Absence is not a failure — many
      // valid final answers don't use that language.
      checks.push({
        name: "completion-claim",
        passed: true, // informational; never fails
        reason: isSatisfied(ctx.content)
          ? undefined
          : "no explicit completion-claim phrasing detected (informational)",
      });

      // Check 5: evidence-grounding
      // For terminal outputs, validate that dollar-amount claims trace back
      // to tool observations. Skip when there's no evidence to ground in.
      if (ctx.priorSteps.length > 0) {
        const corpus = buildEvidenceCorpusFromSteps(ctx.priorSteps);
        if (corpus.length > 0) {
          const grounding = validateOutputGroundedInEvidence(
            ctx.content,
            corpus,
          );
          checks.push({
            name: "evidence-grounded",
            passed: grounding.ok,
            reason: grounding.ok
              ? undefined
              : `ungrounded amounts: ${grounding.violations.join(", ")}`,
          });
        }
      }
    }

    const verified = checks.every((c) => c.passed);
    return {
      verified,
      checks,
      summary: buildSummary(ctx.action, checks),
      action: ctx.action,
    };
  },
};

// ─── Convenience: build a VerificationContext from an ObservationResult ──────

/**
 * Lift an ObservationResult into a VerificationContext. Useful when the
 * caller already has the observation in hand (e.g., act.ts after every
 * tool execution).
 *
 * Sets `terminal: false` by default — the caller must explicitly opt in
 * to terminal verification (which runs the more expensive checks).
 */
export function contextFromObservation(args: {
  readonly observation: ObservationResult;
  readonly task: string;
  readonly priorSteps: readonly ReasoningStep[];
  readonly requiredTools?: readonly string[];
  readonly toolsUsed?: ReadonlySet<string>;
  readonly terminal?: boolean;
}): VerificationContext {
  return {
    action: args.observation.toolName,
    content: args.observation.displayText,
    actionSuccess: args.observation.success,
    task: args.task,
    priorSteps: args.priorSteps,
    requiredTools: args.requiredTools,
    toolsUsed: args.toolsUsed,
    terminal: args.terminal ?? false,
  };
}
