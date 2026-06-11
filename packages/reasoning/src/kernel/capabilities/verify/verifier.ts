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

import { Effect } from "effect";
import type { ReasoningStep } from "../../../types/index.js";
import type { ObservationResult } from "../../../types/observation.js";
import { isSatisfied } from "./quality-utils.js";
import {
  buildEvidenceCorpusFromSteps,
  validateOutputGroundedInEvidence,
} from "./evidence-grounding.js";
import { detectScaffoldLeak } from "./scaffold-leak.js";
import { emitVerifierVerdict } from "../../utils/diagnostics.js";

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
  /**
   * The kernel's `state.meta.terminatedBy` value when verifying terminal
   * output. Distinguishes model-authored answers from harness-assembled
   * fallbacks. The Verifier rejects `"harness_deliverable"` outputs because
   * they indicate the model failed to synthesize — the harness dumped
   * scratchpad artifacts to give the user *something*. That's a signal of
   * synthesis failure, not a synthesized answer, regardless of grounding.
   *
   * Empirical motivation (2026-05-06, cogito:14b T5 trace
   * `01KQZFHFQA97RHHCNXQ792VWNQ`): harness assembled raw `[{...}]` JSON
   * from `_tool_result_*` keys; synthesis-grounded passed because every
   * "claim" was verbatim from observations; quality scorer rated
   * faithfulness=7%. Without this signal the verifier had no way to tell
   * fallback from synthesis.
   */
  readonly terminatedBy?: string;
}

/**
 * Severity of a Verifier check's outcome. GH #121 / I5 promotion of the
 * pre-existing binary `passed: boolean` into a four-level scale so that
 * downstream consumers (Loop Controller, Arbitrator, strategy switcher)
 * can distinguish "passed cleanly" from "advisory warning" from
 * "rejected but recoverable" from "rejected and must escalate".
 *
 * Semantics (consumer contract):
 *   - `pass`     : check succeeded; no action needed.
 *   - `warn`     : advisory failure; surface with warning but don't suppress.
 *                  Maps to the legacy soft-fail concept (evidence/synthesis
 *                  grounding that may miss compressed observations).
 *   - `reject`   : the output is wrong as-shipped; suppress and fail the
 *                  run OR retry within the current strategy.
 *   - `escalate` : the output is structurally compromised (harness fallback,
 *                  shallow give-up); the loop should switch strategy or
 *                  escalate to human-in-loop rather than retry in place.
 *
 * Defaulting rule (back-compat): when a custom Verifier returns checks
 * without `severity`, the default is `passed ? 'pass' : 'reject'`. This
 * preserves the prior binary semantics for any external Verifier impl.
 */
export type VerificationSeverity = "pass" | "warn" | "reject" | "escalate";

/**
 * One named check the Verifier ran with its outcome and reason.
 *
 * Checks are listed in order — gate scenarios + reflection consumers can
 * scan the list to find the first failed check (the "lead" reason for
 * verification failure).
 *
 * `severity` (GH #121 / I5) is the structured signal Loop Controller
 * consumes. `passed` is retained for back-compat — when a check sets
 * `severity`, `passed` MUST also be set consistently (`passed = severity ===
 * 'pass' || severity === 'warn'`). Producers should set both; consumers
 * that read `severity` should call {@link checkSeverity} for the safe
 * default that handles legacy producers.
 */
export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
  /**
   * Severity classification. Optional for back-compat with external
   * Verifier implementations that predate GH #121. When absent, treat as
   * `passed ? 'pass' : 'reject'` (see {@link checkSeverity}).
   */
  readonly severity?: VerificationSeverity;
}

/**
 * Resolve a check's severity with the back-compat default. External
 * Verifier implementations that haven't migrated to per-check severity
 * still produce sensible outcomes through this helper.
 */
export function checkSeverity(check: VerificationCheck): VerificationSeverity {
  if (check.severity !== undefined) return check.severity;
  return check.passed ? "pass" : "reject";
}

/**
 * The Verifier's structured verdict on a single action's outcome.
 *
 * Field semantics post-GH #121:
 *   - `verified` is a **derived** convenience boolean. True iff every
 *     check's severity is `pass`. Any non-pass severity (warn, reject,
 *     escalate) flips it to false — this preserves the legacy contract
 *     used by runner.ts and existing tests, while the finer-grained
 *     severity field below tells the Loop Controller HOW to react.
 *   - `softFail` is a **derived** convenience boolean for the legacy
 *     advisory-failure path. True iff at least one check is `warn` AND
 *     no check is `reject`/`escalate`. Kept on the result so existing
 *     consumers (runner.ts §8.6, telemetry) continue to work unchanged.
 *   - `severity` is the overall severity for downstream branching:
 *     escalate > reject > warn > pass.
 *   - `checks` carries the per-check `severity` (GH #121 / I5) — this is
 *     the structured signal Loop Controller and Arbitrator consume.
 *
 * Loop Controller mapping (runner.ts):
 *   - severity = pass     → terminal acceptance
 *   - severity = warn     → surface output with verifierWarning metadata
 *   - severity = reject   → suppress output + fail (retry within strategy)
 *   - severity = escalate → suppress + tag for strategy switch / HIL
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
  /**
   * When true, the failure is advisory only — the caller should surface
   * the output with a warning rather than suppressing it. Derived from
   * per-check severity post-GH #121.
   */
  readonly softFail: boolean;
  /**
   * Highest-severity failure across all checks, or `'pass'` when all
   * checks passed. The Loop Controller reads this to choose between
   * accept / warn-and-surface / suppress-and-retry / escalate.
   * GH #121 / I5.
   *
   * Optional for back-compat with existing external Verifier
   * implementations (runtime lean mode, custom verifiers in tests) that
   * predate I5. Consumers should default to deriving from
   * `verified`/`softFail` when this field is absent — see
   * {@link resolveResultSeverity}.
   */
  readonly severity?: VerificationSeverity;
}

/**
 * Resolve a VerificationResult's overall severity with the back-compat
 * default. Use this when consuming `result.severity` from external
 * Verifier implementations that may not yet emit the field.
 *
 * Default rule mirrors the legacy boolean shape:
 *   - verified=true            → pass
 *   - softFail=true            → warn
 *   - else                     → reject (no way to distinguish escalate
 *                                without the explicit field)
 */
export function resolveResultSeverity(result: VerificationResult): VerificationSeverity {
  if (result.severity !== undefined) return result.severity;
  if (result.verified) return "pass";
  if (result.softFail) return "warn";
  return "reject";
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
    // Severity: failure is `reject` — the action errored; output is invalid.
    checks.push({
      name: "action-success",
      passed: ctx.actionSuccess,
      severity: ctx.actionSuccess ? "pass" : "reject",
      reason: ctx.actionSuccess
        ? undefined
        : `${ctx.action} returned success=false`,
    });

    // ── Check 2: non-empty-content ───────────────────────────────────────────
    // An action that succeeded but produced zero bytes is suspicious.
    // Severity: failure is `reject` — terminal verification of empty output
    // is never a deliverable; for non-terminal observations the existing
    // legacy semantics treated this as a hard fail too.
    const hasContent = ctx.content.trim().length > 0;
    checks.push({
      name: "non-empty-content",
      passed: hasContent,
      severity: hasContent ? "pass" : "reject",
      reason: hasContent ? undefined : "action returned empty content",
    });

    // ── Terminal-only checks ─────────────────────────────────────────────────
    // Skip these for non-terminal actions. They're expensive and only
    // meaningful when evaluating a candidate final answer.
    if (ctx.terminal && ctx.actionSuccess && hasContent) {
      // Check 3a: output-is-model-authored
      // Reject outputs assembled by the harness fallback path
      // (terminatedBy="harness_deliverable"). The harness assembles raw
      // tool-result artifacts when the model stalls without calling
      // final-answer. Such outputs trivially "ground" because every byte
      // came from observations, but they aren't synthesis — they're a
      // signal of synthesis failure. The retry policy should fire on these.
      //
      // Empirical basis (2026-05-06): cogito:14b T5 trace produced a raw
      // `[{...}]` JSON dump via harness_deliverable; pre-fix synthesis-grounded
      // passed (verified=true, faithfulness=7%). Post-fix the verdict is
      // verified=false here, retry path becomes reachable.
      // Severity: `escalate`. The model failed to synthesize entirely;
      // the right Loop Controller response is to switch strategy or hand
      // off to a different mechanism, not to retry the same path. GH #121.
      if (ctx.terminatedBy === "harness_deliverable") {
        checks.push({
          name: "output-is-model-authored",
          passed: false,
          severity: "escalate",
          reason:
            "output was assembled by harness fallback (terminatedBy=harness_deliverable) — model never produced a synthesized final answer",
        });
      }

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
      // Severity: failure is `reject` — agent shipped output without any
      // required data tool call, but a retry within the same strategy can
      // recover (model often complies on the next iteration once nudged).
      if (requiredDataTools.length > 0) {
        const used = ctx.toolsUsed ?? new Set<string>();
        const nonMetaUsed = [...used].filter((t) => !META_TOOL_SET.has(t));
        const tookAction = nonMetaUsed.length > 0;
        checks.push({
          name: "agent-took-action",
          passed: tookAction,
          severity: tookAction ? "pass" : "reject",
          reason: tookAction
            ? undefined
            : `agent shipped output without calling any required data tool (required: ${requiredDataTools.join(", ")})`,
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

      // HS-cleanup-1: framework markup is stripped at producers (think.ts
      // rationale strip + `step.metadata.frameworkInstrumentation` tags).
      // This verifier check remains as a **producer-regression alarm** —
      // if ANY of these patterns reach the verifier, a producer is leaking
      // scaffold into model-visible content. Fail loud; don't fix silently.
      const PRODUCER_REGRESSION_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
        { pattern: /<rationale\s+call="[^"]*"/i, label: "rationale-XML wrapper (think.ts strip regression)" },
        { pattern: /<\/rationale>/i, label: "orphan rationale-XML close tag (think.ts strip regression)" },
        { pattern: /(^|\n)\[CRITIQUE\s+\d+\]\s+[A-Z]+:/i, label: "reflexion CRITIQUE marker (frameworkInstrumentation tag regression)" },
        { pattern: /(^|\n)\[TOT\]\s/i, label: "tree-of-thought marker (frameworkInstrumentation tag regression)" },
        { pattern: /^\s*\[[^\]]+\s+result\s+[—\-]/i, label: "tool-result preview wrapper (act fallback path regression)" },
      ];
      const producerLeak = PRODUCER_REGRESSION_PATTERNS.find(
        ({ pattern }) => pattern.test(ctx.content),
      );

      const isParrot = startsWithHarnessPrefix || parrotMatch !== null || producerLeak !== undefined;
      // Severity: failure is `reject`. GH #121 / I5 success metric (1):
      // M2a/b/c producer-leak outputs (rationale XML, [CRITIQUE], etc.)
      // must emit severity='reject' so the Loop Controller suppresses the
      // output instead of shipping framework markup to the user.
      checks.push({
        name: "output-not-harness-parrot",
        passed: !isParrot,
        severity: isParrot ? "reject" : "pass",
        reason: isParrot
          ? producerLeak
            ? `framework markup reached user output — ${producerLeak.label}`
            : startsWithHarnessPrefix
              ? "output begins with the harness signal prefix \"⚠️ \" — likely a parroted recovery / loop / oracle nudge"
              : `output echoes a recent harness_signal step verbatim: "${(parrotMatch ?? "").slice(0, 80)}${(parrotMatch ?? "").length > 80 ? "…" : ""}"`
          : undefined,
      });

      // ── Check 3d: output-not-shallow-giveup ────────────────────────────
      // GH #121 / I5 success metric (2): F4 reproduction — agent calls
      // wrong tool (e.g. `find` instead of `recall`), sees 5 results in a
      // truncated preview, and answers "no 7th result exists." Output
      // grounds in observations (those 5 entries are real) → existing
      // grounding checks pass → user gets a false-negative claim.
      //
      // Detection is intentionally narrow to avoid false positives on
      // legitimate "I don't know" answers: shallow give-up requires BOTH
      // (a) a give-up phrase and (b) one or more available data tools
      // that the agent never invoked. When both conditions hold, the
      // model bailed without exhausting capability — that's a structural
      // failure that strategy switching or human-in-loop should handle,
      // not a retry-in-place. Severity: `escalate`.
      const GIVE_UP_PATTERNS: ReadonlyArray<RegExp> = [
        /\b(i\s+cannot\s+(complete|fulfill|answer|provide|find|do))\b/i,
        /\bi['']?m\s+unable\s+to\s+(complete|fulfill|answer|provide|find|do)\b/i,
        /\bno\s+(\d+(st|nd|rd|th)?|further|additional|more)\s+(result|entry|entries|items?|records?)\s+(is|are)?\s*(available|found|present|exists?)/i,
        /\bthere\s+(is|are)\s+no\s+(\d+(st|nd|rd|th)?|further|additional|more)\s+(result|entry|entries|items?|records?)/i,
        /\bonly\s+contains?\s+\d+\s+(result|entry|entries|items?|records?)\b/i,
      ];
      const giveUpMatch = GIVE_UP_PATTERNS.find((p) => p.test(ctx.content));
      // Count distinct user-supplied data tools that were never called.
      // Use availableUserTools rather than requiredTools: a shallow-give-up
      // requires the agent had options it didn't try. Meta-tools are
      // excluded (final-answer/recall/find/etc. are framework helpers).
      const availableUserToolsList = ctx.availableUserTools ?? [];
      const toolsUsed = ctx.toolsUsed ?? new Set<string>();
      const unusedUserTools = availableUserToolsList.filter(
        (t) => !META_TOOL_SET.has(t) && !toolsUsed.has(t),
      );
      if (giveUpMatch && unusedUserTools.length > 0) {
        checks.push({
          name: "output-not-shallow-giveup",
          passed: false,
          severity: "escalate",
          reason: `output appears to give up ("${ctx.content.slice(0, 80)}${ctx.content.length > 80 ? "…" : ""}") while ${unusedUserTools.length} available user tool(s) were never invoked: ${unusedUserTools.slice(0, 5).join(", ")}${unusedUserTools.length > 5 ? "…" : ""}`,
        });
      } else {
        checks.push({
          name: "output-not-shallow-giveup",
          passed: true,
          severity: "pass",
        });
      }

      // Check 4: completion-claim
      // If the model's content includes "satisfied" / completion language,
      // record that as a positive signal. Absence is not a failure — many
      // valid final answers don't use that language.
      // Severity: always `pass` — informational only.
      checks.push({
        name: "completion-claim",
        passed: true, // informational; never fails
        severity: "pass",
        reason: isSatisfied(ctx.content)
          ? undefined
          : "no explicit completion-claim phrasing detected (informational)",
      });

      // Check 4b: scaffold-leak (ALWAYS-ON). Output echoing framework internals
      // ([STORED:], _tool_result_N, compressed preview) is never a valid answer.
      // Severity: reject — always wrong, ~zero false-positive.
      const scaffoldLeak = detectScaffoldLeak(ctx.content);
      checks.push({
        name: "scaffold-leak",
        passed: !scaffoldLeak.leaked,
        severity: scaffoldLeak.leaked ? "reject" : "pass",
        reason: scaffoldLeak.leaked ? scaffoldLeak.reason : undefined,
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
          // Severity: failure is `warn`. Preserves the legacy softFail flow
          // — grounding is advisory because compressed observations and
          // scratchpad lookups frequently produce false negatives. The
          // Loop Controller surfaces the output with a warning rather
          // than suppressing it.
          checks.push({
            name: "evidence-grounded",
            passed: grounding.ok,
            severity: grounding.ok ? "pass" : "warn",
            reason: grounding.ok
              ? undefined
              : `ungrounded amounts: ${grounding.violations.join(", ")}`,
          });
        }
      }
    }

    // ── Derived fields (GH #121 / I5) ────────────────────────────────────────
    // Overall severity rollup (max severity across all checks):
    //   - any escalate → overall = escalate
    //   - else any reject → overall = reject
    //   - else any warn → overall = warn
    //   - else → pass
    // `verified` is true ONLY when overall = pass — preserves legacy contract
    // (runner.ts:1785 `if (!verdict.verified)` still triggers on warn-only).
    // `softFail` mirrors the legacy contract: warn-only failures (no
    // rejects/escalates) — surfaces output with warning rather than
    // suppressing.
    let hasEscalate = false;
    let hasReject = false;
    let hasWarn = false;
    for (const c of checks) {
      const sev = checkSeverity(c);
      if (sev === "escalate") hasEscalate = true;
      else if (sev === "reject") hasReject = true;
      else if (sev === "warn") hasWarn = true;
    }
    const overallSeverity: VerificationSeverity = hasEscalate
      ? "escalate"
      : hasReject
        ? "reject"
        : hasWarn
          ? "warn"
          : "pass";
    const verified = overallSeverity === "pass";
    const softFail = !hasEscalate && !hasReject && hasWarn;

    return {
      verified,
      checks,
      summary: buildSummary(ctx.action, checks),
      action: ctx.action,
      softFail,
      severity: overallSeverity,
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

// ─── Capability-boundary emit wrapper (WS-3 Phase 5a) ───────────────────────
//
// `verifyAndEmit` is the canonical entry point for callers (the kernel loop,
// outer-loop strategies) that need both the structured `VerificationResult`
// AND the trace-event side effect. It enforces invariant 10 of the
// canonical-refactor model: capability emit events fire from capability
// code, never from strategy / loop code.
//
// Pre-WS-3 Phase 5a, runner.ts called `verifier.verify(ctx)` and then
// `yield* emitVerifierVerdict({...})` inline at two sites (the harness-
// fallback verification path and the post-loop terminal verification path).
// That coupled the loop to the trace shape. This helper colocates the emit
// with the verification call so future verifier evolution (new check
// categories, severity remapping, etc.) updates the emit without touching
// runner.ts.
//
// Same semantics as calling `verifier.verify(ctx)` directly — the result is
// returned unchanged. The emit is fire-and-forget at the EventBus boundary
// (it Effect-swallows publish failures via `emitErrorSwallowed`, matching
// the pre-existing helper behavior).
export function verifyAndEmit(args: {
  readonly verifier: Verifier;
  readonly context: VerificationContext;
  readonly taskId: string;
  readonly iteration: number;
}): Effect.Effect<VerificationResult, never> {
  const { verifier, context, taskId, iteration } = args;
  return Effect.gen(function* () {
    const verdict = verifier.verify(context);
    yield* emitVerifierVerdict({
      taskId,
      iteration,
      action: verdict.action,
      terminal: context.terminal === true,
      verified: verdict.verified,
      summary: verdict.summary,
      checks: verdict.checks,
    });
    return verdict;
  });
}
