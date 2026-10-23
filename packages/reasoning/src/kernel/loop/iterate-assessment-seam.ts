/**
 * iterate-assessment-seam.ts — per-pass RunAssessment seam, decomposed
 * VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222; formerly
 * lines 504-550, 552-615, and 673-745).
 *
 * Owns, for one pass with a compiled RunContract: the assess() recompute +
 * requirement-transition ledger mint + `assessment` trace emit (assessAndRecordPass),
 * the W4-live zero-evidence stand-down DISCRIMINATOR (pure — returns the honest
 * abstention reason or null; the driver keeps the single-owner terminate() +
 * break), and the E3 pace-actions block (terminal synthesis force + triage
 * steer). Bodies are byte-identical modulo destructured params and the two
 * control-flow adaptations documented at their exact lines. The
 * recompileOnAssessment block (script-anchored — check-policy-compiler
 * grandfather) stayed INLINE in iterate-pass.ts.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import type { RunContract } from "../contract/run-contract.js";
import type { RunAssessment } from "../assessment/assess.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { assess } from "../assessment/assess.js";
import {
  shouldForceTerminalSynthesis,
  triageSteerText,
} from "../assessment/pace-actions.js";
import { recordRequirementTransitions } from "../ledger/emit.js";
import { forceTerminalSynthesis } from "./runner-helpers/pace-terminal.js";
import { detectFlailSignature } from "./runner-helpers/flail-signature.js";
import {
  countArtifacts,
  countDeliverableCandidates,
} from "./runner-helpers/deliverable.js";
import { emitAssessment, emitHarnessSignalInjected } from "../utils/diagnostics.js";
import { actionToolName } from "../assessment/progress-arbiter.js";
import { authorityOf } from "../capabilities/decide/authority.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";
import type { HorizonProfile } from "./runner-helpers/horizon-profile.js";

/** Assess + record + emit for one pass (former lines 504-550). */
export function assessAndRecordPass(args: {
  state: KernelState;
  readonly contract: RunContract;
  readonly currentOptions: KernelRunOptions;
}): Effect.Effect<{
  state: KernelState;
  readonly assessment: RunAssessment;
  readonly evidenceStaleIterations: number;
}, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { contract, currentOptions } = args;
    let evidenceStaleIterations = 0;

          const limits = state.meta.budgetLimits;
          const assessment = assess(contract, state.ledger ?? [], {
            iteration: state.iteration,
            maxIterations: currentOptions.maxIterations,
            tokensUsed: state.tokens,
            costUsd: state.cost,
            ...(limits?.tokenLimit !== undefined ? { tokenLimit: limits.tokenLimit } : {}),
            ...(limits?.costLimit !== undefined ? { costLimit: limits.costLimit } : {}),
          });
          // B7: mint the requirement lifecycle TRANSITIONS at this gate — assess()
          // is the single, entity-aware satisfaction authority; this persists the
          // ids it partitioned as satisfied|blocked as `requirement` ledger facts,
          // so assess.ts:207 (next iteration) + standing-frame read a REAL lifecycle
          // instead of re-deriving. Routed through the ledger-home emitter (single-
          // writer invariant), threaded via patch.ledger. Idempotent: a persistently
          // satisfied requirement records once, so the ledger does not grow per turn.
          state = transitionState(state, {
            meta: { ...state.meta, assessment },
            ledger: recordRequirementTransitions(
              state.ledger,
              assessment.requirements.satisfied,
              assessment.requirements.blocked,
              state.iteration,
            ),
          });
          yield* emitAssessment({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            phase: assessment.phase,
            band: assessment.pace.band,
            evidenceDelta: assessment.evidenceDelta,
            requirementsSatisfied: assessment.requirements.satisfied.length,
            requirementsOutstanding: assessment.requirements.outstanding.length,
            deliverablesProduced: assessment.deliverables.produced.length,
            deliverablesMissing: assessment.deliverables.missing.length,
            burnRatio: assessment.pace.burnRatio,
          });

          // W4.1 (e) — evidence-staleness iterations. Read from the assessment's
          // already-computed `health.iterationsSinceEvidence` (ledger-derived, so
          // it cannot over-count when a pass assesses more than once). Gated to
          // the working phases (synthesize/verify are not "still gathering").
          const workRemaining =
            assessment.phase !== "synthesize" && assessment.phase !== "verify";
          evidenceStaleIterations = workRemaining
            ? assessment.health.iterationsSinceEvidence
            : 0;
    return { state, assessment, evidenceStaleIterations };
  });
}

/**
 * W4-live — the default-on zero-evidence stand-down threshold. Consecutive
 * iterations with no new substantive evidence while work remains, past which an
 * impossible/zero-progress task terminates honestly instead of grinding. 2 =
 * the live impossible-task shape terminates within two iterations.
 */
const EVIDENCE_STALE_TERMINATE_THRESHOLD = 2;

/** Zero-evidence stand-down DISCRIMINATOR (former lines 552-615): honest
 * abstention reason when the W4-live gate fires, null otherwise. Pure — the
 * driver owns the single-owner terminate() + loop break. */
export function zeroEvidenceStandDownReason(args: {
  readonly state: KernelState;
  readonly assessment: RunAssessment;
  readonly evidenceStaleIterations: number;
  readonly requiredTools: readonly string[];
  readonly horizon?: HorizonProfile;
  readonly currentOptions: KernelRunOptions;
}): string | null {
  const { state, assessment, evidenceStaleIterations, requiredTools, horizon, currentOptions } = args;

          // ── W4-live: default-on zero-evidence stand-down ────────────────────
          // An impossible / zero-progress task (no capable tool, no deliverable,
          // no substantive evidence) must terminate efficiently by DEFAULT — not
          // grind to maxIterations or a graceful loop. Reuses the assessment's
          // ledger-derived staleness signal (the SAME currency as the band rule
          // and pattern (e)) and the honest-abstain single-owner path. Default-on
          // as behavior-ordering over already-computed signals (plan 4.2), with a
          // `.withLongHorizon()` escape hatch (see below).
          //
          // FLAIL REQUIREMENT (round-1 fix): bare staleness is ALSO true of a
          // legitimate no-tool reasoning trajectory (no tools ⇒
          // iterationsSinceEvidence == the iteration index). The stand-down fires
          // only when the trajectory shows a flail signature — REFUSAL (canonical
          // `isGiveUpAnswer`) or REPETITION (near-duplicate thoughts) — so a weak
          // model deriving a multi-step answer across turns is never aborted
          // mid-derivation. See runner-helpers/flail-signature.ts.
          //
          // Operator-tuning guard: an EXPLICIT `loopDetection` config is the
          // operator's override of the loop-machinery family — defer to it (the
          // live default path passes none, so the actuator is armed there).
          //
          // Long-horizon escape hatch: `.withLongHorizon()` (or a contract whose
          // classified horizon is "long") defers the stand-down.
          //
          // Tool guard: any tool ATTEMPT at all (substantive OR meta, even one
          // still in flight) stands the actuator down. A run that is actively
          // calling tools — a legitimate recall/brief/find workflow, a gather in
          // flight — is owned by the loop/recovery guards. Only a trajectory that
          // calls NO tool at all (the live `builtins:false` impossible shape) is
          // zero-progress here. A declared required tool also defers.
          const zeroEvidenceActuatorArmed = currentOptions.loopDetection === undefined;
          const noRequiredTools = requiredTools.length === 0;
          const attemptedAnyTool = state.steps.some(
            (s) => s.type === "action" && actionToolName(s) !== undefined,
          );
          // W4-live fix (round 1) — FLAIL discriminator. Bare staleness is also
          // true of a legitimate no-tool REASONING trajectory (a weak model
          // deriving across turns: no tools ⇒ iterationsSinceEvidence == the
          // iteration index). Fire only on a flail signature — REFUSAL
          // (canonical isGiveUpAnswer) OR REPETITION (near-duplicate thoughts).
          // A deriving run's thoughts change each pass → no signature → survives.
          const flail = detectFlailSignature(state.steps, evidenceStaleIterations);
          // Long-horizon escape hatch: `.withLongHorizon()` (or a contract whose
          // classified horizon is "long") defers the stand-down — long runs are
          // expected to spend many turns without evidence.
          const longHorizonDeferred =
            horizon !== undefined || state.meta.runContract?.horizon === "long";
          if (
            zeroEvidenceActuatorArmed &&
            noRequiredTools &&
            !longHorizonDeferred &&
            state.tokens > 0 &&
            evidenceStaleIterations >= EVIDENCE_STALE_TERMINATE_THRESHOLD &&
            assessment.requirements.outstanding.length > 0 &&
            !attemptedAnyTool &&
            flail.flailing &&
            countArtifacts(state) === 0 &&
            countDeliverableCandidates(state) === 0
          ) {
            const signal = flail.refusal ? "refused to proceed" : "repeated itself without progress";
            const reason =
              `no new task evidence for ${evidenceStaleIterations} iteration(s) while ` +
              `${assessment.requirements.outstanding.length} requirement(s) remain outstanding ` +
              `(the model ${signal}) — the task cannot be grounded with the available tools`;
            return reason;
          }
          return null;
}

/** E3 pace actions — terminal-synthesis force + triage steer (former lines 673-745).
 * The forceTerminalSynthesis `return "break"` adapts to a returned
 * `terminated: true` flag the driver honors. */
export function applyE3PaceActions(args: {
  state: KernelState;
  readonly contract: RunContract;
  readonly assessment: RunAssessment;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  readonly horizon?: HorizonProfile;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}): Effect.Effect<{ state: KernelState; terminated: boolean }, never, LLMService> {
  return Effect.gen(function* () {
    let state = args.state;
    const { contract, assessment, currentInput, currentOptions, horizon, emitLog } = args;

          // ── E3 pace ACTIONS — turn the just-computed pace band into actuator
          // actions (meta-loop Phase 5a / task E3). DAG-safe: READS
          // assessment.pace.band (E1, this iteration), acts on the guidance +
          // terminal actuators, never recomputes assessment / mutates the ledger.
          // OPT-IN behind the long-horizon profile (`horizon !== undefined`); OFF
          // → this whole block is skipped → byte-identical to today.
          //
          // Gate on status "thinking" (the ICS/stall convention): on an "acting"
          // sub-pass a tool call is pending but not yet executed, so acting here
          // would pre-empt in-flight evidence gathering — let the tool complete;
          // the next thinking pass catches the band with the evidence in hand.
          if (horizon !== undefined && state.status === "thinking") {
            // terminal (burnRatio ≥ 0.95): force a generous synthesis NOW, before
            // the next think turn can push spend over the budget_exceeded cliff
            // that would discard the answer (audit 05-#1). Pre-empts at iter-start.
            if (shouldForceTerminalSynthesis(true, assessment)) {
              const llmOpt = yield* Effect.serviceOption(LLMService);
              state = yield* forceTerminalSynthesis({
                state,
                task: currentInput.task,
                llm: llmOpt._tag === "Some" ? llmOpt.value : undefined,
                contract,
                assessment,
                taskId: currentOptions.taskId ?? state.taskId,
                emitLog,
              });
              return { state, terminated: true };
            }
            // triage (burnRatio ≥ 0.80): steer the model to the OUTSTANDING
            // requirements via the guidance channel. Rendered by THIS pass's think
            // turn (guidance is set at iter-start, consumed+cleared by think).
            // Emitted once per distinct outstanding set (dedup on signature) so a
            // run sitting in the triage band does not re-steer every iteration.
            const steer = triageSteerText(true, contract, assessment);
            if (steer) {
              const signature = assessment.requirements.outstanding.join(",");
              if (state.meta.lastTriageSignature !== signature) {
                yield* emitHarnessSignalInjected({
                  taskId: currentOptions.taskId ?? state.taskId,
                  iteration: state.iteration,
                  signalKind: "redirect",
                  origin: "loop/iterate-pass.ts:E3-triage",
                  content: steer,
                  metadata: {
                    trigger: "pace-triage",
                    band: assessment.pace.band,
                    outstanding: assessment.requirements.outstanding.length,
                    burnRatio: assessment.pace.burnRatio,
                  },
                });
                state = transitionState(state, {
                  steps: [
                    ...state.steps,
                    makeStep("harness_signal", `⚠️ ${steer}`, {
                      // Spec §5b (W-Q) — pace-triage steer is a receipt-visible
                      // intervention. Lexical: the burn-ratio band is a
                      // statistical pace heuristic (advisory).
                      intervention: {
                        actor: "pace-triage",
                        authorityClass: authorityOf("pace-triage"),
                        evidence: `burnRatio=${assessment.pace.burnRatio.toFixed(2)} band=${assessment.pace.band}; outstanding=${assessment.requirements.outstanding.length}`,
                        whatChanged: "pace-triage: steered model to outstanding requirements",
                        iter: state.iteration,
                      },
                    }),
                  ],
                  // Merge — never clobber guidance a prior pass queued for this think.
                  pendingGuidance: { ...(state.pendingGuidance ?? {}), triageSteer: steer },
                  meta: { ...state.meta, lastTriageSignature: signature },
                });
              }
            }
          }
    return { state, terminated: false };
  });
}
