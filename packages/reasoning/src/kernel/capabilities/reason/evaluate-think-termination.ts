/**
 * Think phase — termination-oracle stage.
 *
 * `handleThinking`'s exit-decision stage, moved verbatim from `think.ts`
 * (#219 / HS-249 decomposition): the unified scored signal pipeline
 * (`evaluateTermination` + `defaultEvaluators`). Exit verdicts and gate
 * redirects flow through `arbitrateAndApply` exactly as before — the
 * arbitrator remains the only terminal-phase decider; `terminate.ts` the
 * only finalizer — and the continue path updates `priorThought` +
 * iteration. Always returns the final {@link KernelState} for the pass.
 */
import { Effect } from "effect";
import {
  evaluateTermination,
  defaultEvaluators,
  arbitrateAndApply,
  arbitrationContextFromState,
  type TerminationContext,
} from "../decide/arbitrator.js";
import { authorityOf } from "../decide/authority.js";
import { resolveHorizonProfile } from "../../../kernel/loop/runner-helpers/horizon-profile.js";
import { assembleOutput } from "../../../kernel/loop/output-assembly.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { transitionState, type KernelState, type KernelContext } from "../../../kernel/state/kernel-state.js";
import type { ThinkTurnParams } from "./dispatch-think-response.js";

/**
 * Evaluate the termination oracle and produce the final think-phase state
 * — exit, gate redirect, or continue-with-iteration-bump. Single terminal
 * decision path, unchanged.
 */
export function evaluateThinkTermination(turn: ThinkTurnParams) {
  return Effect.gen(function* () {
    const {
      context, newSteps, newTokens, newInputTokens, newOutputTokens,
      newCost, thought, thinking, thoughtResponse,
    } = turn;
    let { state } = turn;
    const { input, hooks } = context;
    // ── TERMINATION ORACLE ──────────────────────────────────────────────────
    // Unified exit decision: replaces scattered hasFinalAnswer, end_turn, and
    // completion-gap checks with a single scored signal pipeline.
    {
      const priorRedirects = newSteps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F Not done yet"),
      ).length;
      // 2026-08-15 \u2014 dedicated evidence-redirect budget: distinguished from
      // priorRedirects (which counts every "Not done yet" redirect, grounding/
      // coverage included) by the evidence guidance's unique "Before
      // finalizing:" text, so a prior grounding/coverage redirect no longer
      // starves the evidence check of its own one-shot turn.
      const priorEvidenceRedirects = newSteps.filter(
        (s) => s.type === "observation" && s.content.includes("Before finalizing:"),
      ).length;
      const priorFAAttempts = state.steps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F") && s.content.includes("final-answer"),
      ).length;

      // A2 — resolve the long-horizon guard scaling from mirrored meta so the
      // veto windows and the coverage gate budget match the arbitrate path.
      // `undefined` off the profile → run-cumulative veto + one-shot redirect.
      const oracleHorizon = resolveHorizonProfile({
        horizonProfile: state.meta.horizonProfile,
        maxIterations: (state.meta.maxIterations as number | undefined) ?? 0,
      });
      const oracleCtx: TerminationContext = {
        thought: thought.trim(),
        thinking: thinking?.trim(),
        stopReason: thoughtResponse.stopReason ?? "end_turn",
        toolRequest: null,
        iteration: state.iteration,
        steps: state.steps,
        // Move 2 / RC#1 — the run-scoped ledger so the terminal gate's coverage
        // check sees delegated writes (steps hold only `spawn-agent`).
        ledger: state.ledger,
        // 2026-08-16 root fix — lets llmEndTurnEvaluator resolve unconsumed
        // stored evidence deterministically (evaluateTerminalGate's evidence check).
        scratchpad: state.scratchpad,
        priorThought: state.priorThought,
        entropy: state.meta.entropy?.latestScore as TerminationContext["entropy"],
        trajectory: state.meta.entropy?.latestTrajectory as TerminationContext["trajectory"],
        controllerDecisions: state.meta.controllerDecisions as TerminationContext["controllerDecisions"],
        // CHANGE A: hand the run-wide controller history to the oracle so
        // controllerSignalVetoEvaluator can detect pathological tactical
        // activity that should override an apparent successful exit.
        controllerDecisionLog: state.controllerDecisionLog,
        ...(oracleHorizon
          ? {
              vetoDecisionWindow: oracleHorizon.vetoDecisionWindow,
              redirectBudget: oracleHorizon.redirectBudget,
            }
          : {}),
        // E2 — surface the assessment phase ONLY under the profile so
        // controllerSignalVetoEvaluator stands down in synthesize (veto-at-
        // finish-line). Absent off the profile → byte-identical.
        ...(oracleHorizon && state.meta.assessment
          ? { assessmentPhase: state.meta.assessment.phase }
          : {}),
        toolsUsed: state.toolsUsed,
        requiredTools: (state.meta.requiredTools as string[]) ?? (input.requiredTools as string[]) ?? [],
        allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
        redirectCount: priorRedirects,
        evidenceRedirectCount: priorEvidenceRedirects,
        priorFinalAnswerAttempts: priorFAAttempts,
        taskDescription: input.task,
        // B2 check 2.5: hand the compiled RunContract to the terminal gate's
        // coverage check (via llmEndTurnEvaluator). Absent → tool-name coverage.
        ...(state.meta.runContract !== undefined
          ? { runContract: state.meta.runContract }
          : {}),
      };

      const decision = evaluateTermination(oracleCtx, defaultEvaluators);

      // CHANGE A: a "fail" verdict from the veto evaluator transitions to
      // status:"failed" — the kernel terminates and result.success becomes
      // false. The agent's textual output (if any) is discarded; the
      // veto reason becomes state.error.
      // Sprint 3.3 — both fail and exit verdicts now flow through the
      // Arbitrator via the oracle-decision intent. The Arbitrator
      // forwards the oracle's action and applies status:failed for fail,
      // status:done for exit. Output is assembled either way.
      if (decision.shouldExit) {
        const assembled = decision.output
          ? assembleOutput({
              steps: state.steps,
              finalAnswer: decision.output,
              terminatedBy: decision.reason,
              entropyScores: state.meta.entropy?.entropyHistory,
            })
          : { text: "" };
        const stateWithSteps = transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
        });
        return arbitrateAndApply(
          stateWithSteps,
          {
            kind: "oracle-decision",
            decision,
            output: assembled.text,
          },
          arbitrationContextFromState(stateWithSteps, {
            task: input.task,
            requiredTools: input.requiredTools,
          }),
          {
            evaluator: decision.evaluator,
            allVerdicts: decision.allVerdicts,
          },
        );
      }

      if (decision.action === "redirect") {
        const gapMsg = `\u26A0\uFE0F Not done yet — ${decision.reason}.\nComplete remaining actions before finishing.`;
        const gapStep = makeStep("observation", gapMsg, {
          observationResult: makeObservationResult("completion-guard", false, gapMsg),
          // Spec §5b — the piece-1 proposal rejection is a receipt-visible
          // intervention: an exit PROPOSAL (from `decision.evaluator`) was
          // redirected because the terminal gate found outstanding criteria.
          intervention: {
            actor: decision.evaluator,
            authorityClass: authorityOf(decision.evaluator),
            evidence: decision.reason.slice(0, 200),
            whatChanged: "gate-redirect: run continued with outstanding criteria",
            iter: state.iteration,
          },
        });
        yield* hooks.onObservation(state, gapMsg, false);
        return transitionState(state, {
          steps: [...newSteps, gapStep],
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thought.trim(),
          meta: { ...state.meta, redirectCount: (priorRedirects + 1) },
        });
      }

      // Continue — update priorThought for next iteration's stability check
      state = transitionState(state, { priorThought: thought.trim() });
    }

    // No tool request and oracle said continue — increment iteration and loop
    return transitionState(state, {
      steps: newSteps,
      tokens: newTokens,
      inputTokens: newInputTokens,
      outputTokens: newOutputTokens,
      cost: newCost,
      iteration: state.iteration + 1,
    });
  });
}
