/**
 * runner-terminal-verify-gate.ts — §9.0 Sprint 3.5 terminal verifier gate,
 * decomposed VERBATIM from runner.ts (quality program Task 9 / GH #222;
 * formerly lines 1308-1702).
 *
 * Owns, for a `done` run with output: the DEBUG_VERIFIER pre-snapshot, the
 * terminal state snapshot emit, the terminal verify+emit, the Phase D1
 * block-mode evidence-grounding cap-then-degrade loop, the Phase D2
 * scaffold-leak synthesize-once repair, and the severity branching
 * (escalate / softFail / hard-reject + fabrication-guard step). The runner
 * keeps the single call site; termination discipline is untouched (this gate
 * only writes status:"failed" transitions via transitionState, never "done").
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { harnessSynthesisDeliverable } from "@reactive-agents/core";
import type { TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { gatewayComplete } from "../llm-gateway.js";
import { authorityOf } from "../../kernel/capabilities/decide/authority.js";
import {
  resolveResultSeverity,
  verifyAndEmit,
  humanizeVerifierFailure,
  type Verifier,
} from "../../kernel/capabilities/verify/verifier.js";
import { VERIFIER_REJECTION_PREFIX, VERIFIER_ESCALATION_PREFIX } from "../verifier-message-prefixes.js";
import { emitKernelStateSnapshot } from "../../kernel/utils/diagnostics.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import {
  transitionState,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../kernel/state/kernel-state.js";
import {
  buildSynthesisPrompt,
} from "./output-synthesis.js";
import { decideGroundingBlockOutcome } from "./runner-helpers/grounding-block.js";
import {
  commitDeliverable,
  collectValidatedObservations,
} from "./runner-helpers/deliverable.js";

/** Run the §9.0 terminal verifier gate over a finalized `state` (Effect). */
export function runTerminalVerifierGate(args: {
  state: KernelState;
  readonly verifier: Verifier;
  readonly effectiveInput: KernelInput;
  readonly taskIntent: TaskIntent;
  readonly currentOptions: KernelRunOptions;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly isAwaitingApproval: boolean;
  readonly isAwaitingInteraction: boolean;
  readonly isAbstained: boolean;
  readonly isBudgetTerminal: boolean;
}): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    let { state } = args;
    const { verifier, effectiveInput, taskIntent, currentOptions, emitLog, isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal } = args;

    // ── 9.0. Sprint 3.5 — Verifier gate before shipping any output ───────────
    // Per North Star §3 (Verify capability) — the harness MUST verify the
    // final output satisfies the task before declaring success. Without this,
    // the model can ship parroted system guidance ("Your next step: call X")
    // as its answer because the output is in state.output and status is "done".
    //
    // The defaultVerifier with terminal=true runs:
    //   - required-tools-satisfied (catches "no tool was called" parrots)
    //   - scaffold-leak (catches framework-internal scaffolding echoed as the answer)
    //
    // On verifier rejection: transition to status="failed" with the verdict
    // in state.error. The reactive.ts strategy adapter (Sprint 3.4 stage 2)
    // already ensures state.error doesn't leak as state.output; user sees
    // null output + structured error.
    if (process.env.DEBUG_VERIFIER === "1") {
      // WS-5 Phase 3: migrated from console.error to Effect.logDebug. The
      // [VERIFIER-PRE] trace is a debug-only diagnostic for the verifier-pre
      // snapshot path; routing through Effect.logDebug threads it into the
      // structured observability sink instead of stdout. Env-gate preserved
      // (opt-in semantics — high-frequency message).
      yield* Effect.logDebug(
        `[VERIFIER-PRE] status=${state.status} hasOutput=${!!state.output} terminatedBy=${state.meta.terminatedBy} outLen=${(state.output ?? "").length} stepsCount=${state.steps.length}`,
      );
    }

    // ── Terminal snapshot (pre-verifier) ─────────────────────────────────────
    // Records the exact state the verifier gate inspects. With both an iter-end
    // snapshot AND this terminal one, a trace narrative becomes complete:
    // iter-start → iter-end → terminal → verifier-verdict. Without this, you
    // can't tell whether the verifier rejected the kernel's true final state
    // or some intermediate state.
    yield* emitKernelStateSnapshot({
      state,
      taskId: currentOptions.taskId ?? state.taskId,
      iteration: state.iteration,
    });

    if (
      state.status === "done" &&
      state.output &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      // availableUserTools — pass through the user-registered tool list
      // so the verifier can run classifier-independent "agent-took-action"
      // checks (rejects parrots / hallucinated answers / meta-tool dumps
      // when the user wired data tools but the agent never invoked them).
      const availableUserTools = (effectiveInput.availableToolSchemas ?? []).map(
        (t) => t.name,
      );
      // WS-3 Phase 5a — verify+emit colocated at the verify capability
      // boundary. `verdict` is still consumed below (severity branching,
      // softFail surfacing, escalation tagging).
      //
      // `buildTerminalVerifyContext(content)` keeps the verifier context
      // literal in one place so the Phase-D1 block-mode corrective re-verify
      // (below) inspects the same priorSteps/grounding/scratchpad as the first
      // pass — only the candidate `content` changes between attempts.
      const buildTerminalVerifyContext = (content: string) => ({
        action: "final-answer" as const,
        content,
        actionSuccess: true,
        task: effectiveInput.task,
        priorSteps: state.steps,
        requiredTools: effectiveInput.requiredTools,
        relevantTools: effectiveInput.relevantTools,
        toolsUsed: state.toolsUsed,
        availableUserTools,
        terminal: true,
        grounding: effectiveInput.grounding,
        fabricationGuard: effectiveInput.fabricationGuard,
        scratchpad: state.scratchpad,
        // H5 (2026-07-08 sweep, audit 02-#4, trace 01KWZ811 seq 1920-1926):
        // without terminatedBy, the authoritative terminal verify cannot see
        // harness authorship — the stall path's own verdict correctly failed
        // output-is-model-authored (escalate), then THIS context re-verified
        // the same harness-assembled output as "9 checks passed" two seqs
        // later with no new model turn, and the run shipped success. The
        // verifier's check 3a keys on terminatedBy=harness_deliverable.
        terminatedBy: state.meta.terminatedBy,
      });
      let verdict = yield* verifyAndEmit({
        verifier,
        context: buildTerminalVerifyContext(state.output),
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        // W5.2 — stamp the completion-judgment entry ref when the shadow fires.
        onJudgmentRef: (ref) => {
          state = transitionState(state, { meta: { ...state.meta, completionJudgmentRef: ref } });
        },
      });

      // ── Phase D1 — block-mode evidence-grounding: cap-then-degrade ─────────
      // When grounding is enabled in `block` mode and the terminal verdict
      // carries an `evidence-grounded` reject, attempt up to
      // `grounding.maxRetries` (default 1) CORRECTIVE synthesis passes that
      // inject the ungrounded figures as guidance. If a corrective pass
      // grounds → accept. If the budget is exhausted → DEGRADE to warn: the
      // answer ships with `verificationWarning`, status stays non-failed.
      // This NEVER hard-fails the run and NEVER loops past the cap — both are
      // enforced by the pure `decideGroundingBlockOutcome` decision. `warn`
      // mode is untouched (it rides the softFail surface path below).
      let groundingDegradeWarning: string | undefined;
      // Bounded by the pure decision: the loop can only iterate while the
      // decision returns `retry`, which is impossible past `maxRetries`.
      while (state.status === "done" && state.output) {
        const outcome = decideGroundingBlockOutcome(
          verdict,
          state.meta.groundingBlockRetry ?? 0,
          effectiveInput.grounding,
        );
        if (outcome.kind === "pass") break;
        if (outcome.kind === "degrade") {
          groundingDegradeWarning = outcome.warning;
          break;
        }
        // outcome.kind === "retry": one corrective synthesis attempt.
        state = transitionState(state, {
          meta: {
            ...state.meta,
            groundingBlockRetry: (state.meta.groundingBlockRetry ?? 0) + 1,
          } as KernelState["meta"],
        });
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag !== "Some") {
          // No LLM to re-synthesize with — cannot correct. Degrade now rather
          // than spin: surface the answer with the grounding warning.
          groundingDegradeWarning = outcome.guidance;
          break;
        }
        // H3 (2026-07-08, audit 05-E2): grounding-corrected re-synthesis IS the
        // deliverable when it succeeds — terse (2048) truncated it.
        const corrected = yield* gatewayComplete(llmOpt.value, { purpose: "synthesize", budgetClass: "generous" }, {
            messages: [
              {
                role: "user",
                content:
                  `${buildSynthesisPrompt(state.output ?? "", taskIntent.format ?? "prose", effectiveInput.task, taskIntent)}\n\n${outcome.guidance}`,
              },
            ],
            temperature: 0.2,
          })
          .pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));
        const correctedContent = extractThinkingSafeContent(corrected).content;
        if (!correctedContent || correctedContent.trim().length === 0) {
          // Synthesis produced nothing usable — keep the original answer and
          // re-decide; the bumped counter guarantees the next pass degrades.
          continue;
        }
        // Single-writer: route the corrected answer through commitDeliverable.
        // harness_synthesis provenance — the harness ran an LLM synthesis pass
        // to produce this corrected prose (S11: not model_synthesis).
        state = commitDeliverable(
          state,
          harnessSynthesisDeliverable([], undefined, correctedContent),
        );
        verdict = yield* verifyAndEmit({
          verifier,
          context: buildTerminalVerifyContext(correctedContent),
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
          onJudgmentRef: (ref) => {
            state = transitionState(state, { meta: { ...state.meta, completionJudgmentRef: ref } });
          },
        });
      }

      // ── Phase D2 (2026-09-30), scaffold-leak remediation: synthesize-once ───
      // The scaffold-leak guard (verifier Check 4b) is always-on and its
      // `reject` previously meant an instant hard-fail: the model echoed
      // framework-internal scaffolding as its answer, and the whole run died
      // even though the DATA needed to produce the real answer sat in the
      // scratchpad. The repair machinery already exists everywhere EXCEPT the
      // default path: finalize.ts `decideSynthesisInput` forces DATA→FORMAT
      // synthesis for leaks on reflexion/plan-execute, and the arbitrator's
      // `synthesisQualityRetry` retries once for text-protocol final-answers -
      // but native-FC runs never offer the `final-answer` tool, so the
      // terminal gate was their only checkpoint, with zero repair attempts.
      // Live incident (taskId 01M3T04DXBYSYMXTRPSH57AT93): ExecutionError
      // "Verifier rejected output: final-answer: failed at scaffold-leak".
      // Mirror the D1 cap-then-degrade precedent: ONE corrective synthesis
      // pass from the validated observations (falling back to the leaked
      // draft when there are none), re-verified against the SAME terminal
      // context. Clean → ship with honest harness_synthesis provenance.
      // Still leaking → the hard-fail branch below runs unchanged, with the
      // specific rejection reason preserved on the receipt. The guard is NOT
      // weakened: a scaffolding dump can still never reach the user.
      if (
        groundingDegradeWarning === undefined &&
        state.status === "done" &&
        state.output &&
        !verdict.verified &&
        verdict.checks.find((c) => !c.passed)?.name === "scaffold-leak"
      ) {
        // DATA source: the same success-gated, scratchpad-resolved
        // observations `assembleDeliverable` trusts, NOT the leaked draft
        // (re-synthesizing from the echo alone would just echo again).
        const observations = collectValidatedObservations(state);
        const rawForSynthesis =
          observations.length > 0
            ? observations.map((o) => `[${o.toolName}] ${o.content}`).join("\n\n---\n\n")
            : state.output;
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag === "Some") {
          // Same abstract wording as the arbitrator's retry feedback, local
          // models copy literal negative examples verbatim, so never quote
          // the bad output back into the corrective prompt.
          const repairGuidance =
            "Your previous answer was rejected because it described the structure of the tool result instead of synthesizing the actual values. Use the concrete fields (titles, scores, names, numbers) from the tool observations above and produce the answer the user requested. Do not describe the data, present it.";
          const repairPrompt =
            `${buildSynthesisPrompt(rawForSynthesis, taskIntent.format ?? "prose", effectiveInput.task, taskIntent)}\n\n${repairGuidance}`;
          // H3 rule: this pass renders the deliverable, generous budget.
          const repaired = yield* gatewayComplete(
            llmOpt.value,
            { purpose: "synthesize", budgetClass: "generous" },
            {
              messages: [{ role: "user", content: repairPrompt }],
              temperature: 0.2,
              traceContext: {
                taskId: currentOptions.taskId ?? state.taskId,
                iteration: state.iteration,
              },
            },
          ).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));
          const repairedContent = extractThinkingSafeContent(repaired).content;
          if (repairedContent && repairedContent.trim().length > 0) {
            // Single-writer: commitDeliverable owns state.output. S11
            // provenance, the harness ran an LLM synthesis pass to produce
            // this prose (not model_synthesis).
            state = commitDeliverable(
              state,
              harnessSynthesisDeliverable([], undefined, repairedContent),
            );
            verdict = yield* verifyAndEmit({
              verifier,
              context: buildTerminalVerifyContext(repairedContent),
              taskId: currentOptions.taskId ?? state.taskId,
              iteration: state.iteration,
              onJudgmentRef: (ref) => {
                state = transitionState(state, { meta: { ...state.meta, completionJudgmentRef: ref } });
              },
            });
            yield* emitLog({
              _tag: "warning",
              message: verdict.verified
                ? "The answer echoed internal scaffolding, so it was rebuilt from the tool data."
                : "The answer echoed internal scaffolding; rebuilding it from the tool data did not pass verification either.",
              context: `[scaffold-leak-repair] re-verified=${verdict.verified} ${verdict.summary}`,
              timestamp: new Date(),
            });
          }
        }
      }

      if (groundingDegradeWarning !== undefined) {
        // DEGRADE-to-warn: surface the answer WITH a warning; do NOT nullify,
        // do NOT fail. Mirrors the softFail warn-surface contract. The honesty
        // marker (`verificationWarning`) crosses the strategy boundary via the
        // CompletionEnvelope (spec §1b). The in-kernel verifier owns CONTROL
        // FLOW here; `receipt.verifierVerdict` is owned by the result-boundary
        // verifier (runtime `result-verification.ts`) — B4/§5.3.
        state = transitionState(state, {
          meta: {
            ...state.meta,
            verificationWarning: groundingDegradeWarning,
          },
        });
      } else if (!verdict.verified) {
        // GH #121 / I5 Loop Controller wire — resolve severity with the
        // back-compat default so external Verifier implementations that
        // predate I5 still get a sensible classification.
        const verdictSeverity = resolveResultSeverity(verdict);
        // User-facing message stays plain-English (see `humanizeVerifierFailure`
        // docstring) — the raw check-id/reason string still rides along in
        // `context`, which only the verbose/non-status log formats render, so
        // debugging detail isn't lost, just no longer the first thing a user
        // sees on a TTY status line.
        const firstFailedCheck = verdict.checks.find((c) => !c.passed);
        const friendlyReason = firstFailedCheck ? humanizeVerifierFailure(firstFailedCheck.name) : undefined;
        yield* emitLog({
          _tag: "warning",
          message: friendlyReason
            ? `The model's answer needed a second look: ${friendlyReason}.`
            : `[verifier] terminal output rejected (severity=${verdictSeverity}): ${verdict.summary}`,
          context: friendlyReason ? `[verifier] severity=${verdictSeverity}: ${verdict.summary}` : undefined,
          timestamp: new Date(),
        });
        //   - escalate : structural failure (harness fallback, shallow give-up).
        //                Suppress by FAILING the run — the `failed` status +
        //                error IS the escalation signal, and it crosses the
        //                strategy boundary as the envelope's `failed`
        //                completionStatus. (The former `verifierEscalation`
        //                meta write had zero readers — deleted in B4/§5.3.)
        //   - reject   : recoverable hard failure (parrot, missing required
        //                action). Suppress entirely. Identical to legacy
        //                non-softFail path.
        //   - warn     : advisory (grounding miss). Surface with metadata;
        //                do NOT nullify output. Identical to legacy
        //                softFail path.
        // H5 refinement (2026-07-08, audit 02-#4): when the ONLY failed check
        // is harness authorship (output-is-model-authored on a
        // harness_deliverable terminal), the run legitimately delivered
        // partial artifacts after budget/nudge exhaustion — killing it would
        // erase real progress. The defect being fixed is the LIE, not the
        // delivery: pre-fix, a context missing terminatedBy re-verified the
        // same output as "9 checks passed" (trace 01KWZ811 seq 1920→1923).
        // Ship it HONESTLY LABELED instead: verified stays false in the
        // verdict record, a verification warning + harnessAuthoredOutput
        // surface to receipts/telemetry, and no clean-success flip occurs.
        const onlyHarnessAuthorshipFailed =
          state.meta.terminatedBy === "harness_deliverable" &&
          verdict.checks.every((c) => c.passed || c.name === "output-is-model-authored");
        if (onlyHarnessAuthorshipFailed) {
          // `harnessAuthoredOutput` is now a DECLARED meta field with a real
          // consumer: `resolveCompletionStatus` degrades this run to `partial`,
          // so the caller sees `success:false` beside the preserved answer. It
          // used to be an untyped stowaway that nothing read, and the run
          // reported a clean success (H5 / wiring audit 2026-07-09).
          state = transitionState(state, {
            meta: {
              ...state.meta,
              verificationWarning: verdict.summary,
              harnessAuthoredOutput: true,
            },
          });
        } else if (verdictSeverity === "escalate") {
          // Structural failure: the `failed` status + error IS the escalation
          // signal (crosses the boundary as the envelope's `failed`
          // completionStatus). The former `verifierEscalation`/`verifierVerdict`
          // meta writes had zero readers — deleted in B4/§5.3.
          state = transitionState(state, {
            status: "failed",
            error: `${VERIFIER_ESCALATION_PREFIX}${verdict.summary}`,
          });
        } else if (verdict.softFail) {
          // Advisory failure: grounding check missed compressed observation.
          // Surface output with warning metadata; do NOT nullify.
          state = transitionState(state, {
            meta: {
              ...state.meta,
              verificationWarning: verdict.summary,
            },
          });
        } else {
          // Hard failure: parrot or harness-authored output. Suppress entirely.
          // The `failed` status + error crosses the boundary as the envelope's
          // `failed` completionStatus; `receipt.verifierVerdict` is owned by the
          // result-boundary verifier (result-verification.ts), NOT by a meta
          // field dropped here (B4/§5.3).
          // The error message carries the verdict summary so result-boundary
          // verification can extract and preserve the specific rejection reason.
          state = transitionState(state, {
            status: "failed",
            error: `${VERIFIER_REJECTION_PREFIX}${verdict.summary}`,
          });
        }

        // Spec §5b (W-Q / task #54) — when the ALWAYS-ON fabricated-measurement
        // guard is the (or a) failing check, record it as a receipt-visible
        // intervention on a dedicated step. Deterministic: the guard rejects
        // ONLY perf measurements no tool observation produced (evidence-driven).
        // `receipt.verifierVerdict` is owned by the result-boundary verifier
        // (runtime `result-verification.ts`), which runs on EVERY path — NOT by
        // the in-kernel verdict above (which governs control flow only; its
        // former `meta.verifierVerdict` write had zero receipt readers, B4/§5.3).
        // This step additionally names the guard in `interventions[]` so the
        // debugging spine shows WHICH control actor fired. Stamped after the
        // branch chain so it rides whichever meta transition applied.
        const fabCheck = verdict.checks.find(
          (c) => c.name === "output-not-fabricated-measurement" && !c.passed,
        );
        if (fabCheck !== undefined) {
          state = transitionState(state, {
            steps: [
              ...state.steps,
              makeStep(
                "harness_signal",
                `⚠️ fabrication guard: ${fabCheck.reason ?? "fabricated measurement rejected"}`,
                {
                  intervention: {
                    actor: "fabrication-guard",
                    authorityClass: authorityOf("fabrication-guard"),
                    evidence: (fabCheck.reason ?? "fabricated measurement with no tool evidence").slice(0, 200),
                    whatChanged: "fabrication-guard: terminal output rejected (fabricated measurement)",
                    iter: state.iteration,
                  },
                },
              ),
            ],
          });
        }
      }
    }
    return state;
  });
}
