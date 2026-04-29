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
  validateGeneralizedGrounding,
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
  /**
   * Relevant tools — classifier-inferred set the agent likely needs for the
   * task. Distinct from requiredTools (which is enforced by the dispatcher).
   * The Verifier consults this to detect "agent took no action despite
   * classifier suggesting tools were needed" — a common failure mode where
   * the model parrots system guidance without invoking any tool.
   */
  readonly relevantTools?: readonly string[];
  /** Tools called so far this run. */
  readonly toolsUsed?: ReadonlySet<string>;
  /**
   * Tool names the user actually registered for the agent (excluding meta-tools).
   * Distinct from requiredTools/relevantTools (classifier output). The Verifier
   * uses this for a classifier-independent "agent took action" check: if the
   * user gave the agent data tools but the agent shipped output without
   * invoking any of them, the answer is suspect — common parrot failure mode.
   */
  readonly availableUserTools?: readonly string[];
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

// ─── Retry policy ─────────────────────────────────────────────────────────────
//
// Sprint 3.5 Stage 2.5 — verifier-driven retry is developer-controllable.
// The runner ships with `defaultVerifierRetryPolicy` (retry on any rejection,
// once per run). Developers needing finer control can supply their own:
//
//   .withReasoning({
//     verifierRetryPolicy: ({ verdict, retriesUsed, state }) => {
//       // e.g. don't retry on long-form synthesis where the model adds more
//       // fabrication when re-rolling (empirical: T5 regressions, 2026-04-27).
//       if (state.steps.length > 6 && verdict.summary.includes("synthesis-grounded")) {
//         return { retry: false, reason: "long-form synthesis: retry empirically regresses" };
//       }
//       return { retry: retriesUsed < 1, signalText: customNudge(verdict) };
//     },
//   })
//
// The policy is consulted on every verifier rejection. `retry: false` lets
// the §9.0 outer gate fail the run definitively; `retry: true` injects a
// harness signal and re-enters the kernel loop.

/**
 * Inputs the retry policy consults to decide whether a rejected output
 * should trigger another iteration with verifier feedback.
 */
export interface VerifierRetryPolicyContext {
  /** The rejection verdict from this iteration. */
  readonly verdict: VerificationResult;
  /** Iteration number when the verdict fired. */
  readonly iteration: number;
  /** Retries already consumed on this run (0 on first rejection). */
  readonly retriesUsed: number;
  /** Configured maxVerifierRetries (the upper bound). */
  readonly maxRetries: number;
  /** Step count — useful proxy for output complexity. */
  readonly stepCount: number;
  /** Tools called so far — useful for "agent took action" reasoning. */
  readonly toolsUsed: ReadonlySet<string>;
}

/**
 * The decision the policy returns.
 *
 * `retry: true` → kernel injects a feedback step (defaults to verdict-based
 * text; override via `signalText`) and continues the loop.
 *
 * `retry: false` → outer §9.0 verifier gate fails the run definitively.
 *
 * `reason` is purely for observability — surfaces in the trace event so
 * developers can audit policy decisions.
 */
export interface VerifierRetryDecision {
  readonly retry: boolean;
  readonly signalText?: string;
  readonly reason?: string;
}

/**
 * Pure function: rejection + context → retry decision. Developers can
 * compose / wrap / swap freely.
 */
export type VerifierRetryPolicy = (
  ctx: VerifierRetryPolicyContext,
) => VerifierRetryDecision;

/**
 * Default retry policy — retry on any rejection while the budget allows.
 * Mirrors pre-injection behavior so existing runs are unaffected when no
 * custom policy is supplied.
 */
export const defaultVerifierRetryPolicy: VerifierRetryPolicy = (ctx) => {
  if (ctx.retriesUsed >= ctx.maxRetries) {
    return { retry: false, reason: "retry budget exhausted" };
  }
  return { retry: true, reason: "default policy: retry on any rejection" };
};

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
      // NOTE: required-tools-satisfied was removed — runner's post-loop required-tools
      // check (runner.ts §8) already enforces this with delegation awareness
      // (sub-agent tools satisfy parent requirements). The verifier's flat
      // `requiredTools.filter((t) => !used.has(t))` lacked that awareness and
      // double-rejected legitimate delegated runs. Output structural verification
      // stays in §8; the verifier focuses on output-quality signals below.

      // Check 3b: agent-took-action (only when user REQUIRED tools).
      //
      // History: this check originally fired whenever the user had ANY data
      // tools wired (availableUserTools non-empty). That was tuned for the
      // p01b spike (cogito:8b on rw-2) where the agent fabricated answers
      // without calling required tools. Generalized as default, the check
      // false-positives on every task that doesn't need tools — e.g. asking
      // for the capital of France while a `recall` tool is also wired
      // produces a verifier rejection because no data tool was called, even
      // though the agent answered correctly from prior knowledge.
      //
      // Stage 5 quality fix: gate on explicit user intent. If the user
      // declared `requiredTools`, enforce. Otherwise, the agent is free to
      // answer from knowledge. The p01b case is preserved because that
      // scenario has explicit `requiredTools: ["search-orders"]`.
      const META_TOOL_SET = new Set([
        "final-answer",
        "task-complete",
        "context-status",
        "brief",
        "pulse",
        "find",
        "recall",
        "checkpoint",
        "activate-skill",
        "discover-tools",
      ]);
      const requiredDataTools = (ctx.requiredTools ?? []).filter(
        (t) => !META_TOOL_SET.has(t),
      );
      if (requiredDataTools.length > 0) {
        const used = ctx.toolsUsed ?? new Set<string>();
        const nonMetaUsed = [...used].filter((t) => !META_TOOL_SET.has(t));
        checks.push({
          name: "agent-took-action",
          passed: nonMetaUsed.length > 0,
          reason:
            nonMetaUsed.length === 0
              ? `agent shipped output without calling any required data tool (required: ${requiredDataTools.join(", ")})`
              : undefined,
        });
      }

      // Check 3c: output-not-harness-parrot
      // Detect when the agent's "answer" is a near-verbatim echo of a
      // recent harness_signal step (recovery nudge, oracle nudge, loop-
      // detector follow-up, dispatcher status). Per types/step.ts:
      // `isUserVisibleStep` — harness_signal content "MUST" be filtered
      // from deliverables; without enforcement here it leaks to the user
      // when the LLM, presented with a steering signal in its context,
      // echoes it back as a thought that subsequently gets promoted to
      // state.output via §8.7 consolidation.
      //
      // Two matchers, both deliberately conservative:
      //   (a) output starts with the harness's distinctive "⚠️ " prefix
      //       (real LLM answers virtually never do).
      //   (b) stripped output exactly equals or is contained in / contains
      //       the stripped content of a recent harness_signal step (look
      //       back ≤10 steps).
      //
      // Conservative bounds: only fires on terminal verification where
      // the agent has produced a candidate final answer; would-be false
      // positive only when an LLM legitimately reproduces a system
      // notice verbatim — extremely rare in practice.
      const HARNESS_SIGNAL_PREFIX = "⚠️ "; // "⚠️ "
      const stripPrefix = (s: string): string =>
        s.replace(/^[\s⚠️]+/, "").trim();
      const strippedOutput = stripPrefix(ctx.content);
      const startsWithHarnessPrefix = ctx.content.trimStart().startsWith(
        HARNESS_SIGNAL_PREFIX,
      );

      const recentHarnessSignals = ctx.priorSteps
        .slice(-10)
        .filter((s) => s.type === "harness_signal")
        .map((s) => stripPrefix(s.content))
        .filter((c) => c.length > 0);

      let parrotMatch: string | null = null;
      if (strippedOutput.length > 0) {
        for (const sig of recentHarnessSignals) {
          if (
            strippedOutput === sig ||
            strippedOutput.includes(sig) ||
            sig.includes(strippedOutput)
          ) {
            parrotMatch = sig;
            break;
          }
        }
      }

      const isParrot = startsWithHarnessPrefix || parrotMatch !== null;
      checks.push({
        name: "output-not-harness-parrot",
        passed: !isParrot,
        reason: isParrot
          ? startsWithHarnessPrefix
            ? "output begins with the harness signal prefix \"⚠️ \" — likely a parroted recovery / loop / oracle nudge"
            : `output echoes a recent harness_signal step verbatim: "${(parrotMatch ?? "").slice(0, 80)}${(parrotMatch ?? "").length > 80 ? "…" : ""}"`
          : undefined,
      });

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

      // Check 5: evidence-grounding (legacy: dollar amounts only)
      // Kept for backward compat — financial-task-specific signal.
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

          // Check 6: Sprint 3.4 Scaffold 2 — generalized grounding.
          // Catches the WHOLE class of fabrication (titles, names, IDs, not just
          // dollar amounts) AND the framework-compression-marker echo failure
          // mode. Task-agnostic: works for any synthesis task.
          const generalGrounding = validateGeneralizedGrounding(
            ctx.content,
            corpus,
          );
          checks.push({
            name: "synthesis-grounded",
            passed: generalGrounding.verified,
            reason: generalGrounding.verified ? undefined : generalGrounding.reason,
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
