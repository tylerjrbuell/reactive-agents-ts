// File: src/kernel/loop/turn-guard-operations.ts
/**
 * The guard and control operations of the kernel turn (Plan 9 Phase 4) — the
 * `KERNEL_TURN_OPERATIONS` entries whose bodies the CI gates
 * content-match, moved verbatim out of `iterate-pass.ts`:
 *   · private run-progress counter writes — `scripts/check-run-assessment.sh`;
 *   · the two `applyStrategySwitch(` calls — `scripts/check-control-plane.sh`;
 *   · the `recompileOnAssessment(` call — `scripts/check-policy-compiler.sh`.
 * Those scripts name THIS file; the unanchored operations live in
 * `turn-operations.ts` (`SEAM_TURN_OPERATIONS`).
 *
 * HOW AN OPERATION ENDS THE RUN
 * -----------------------------
 * Only through the exit gate (`exit-gate.ts`). An operation proposes — a guard
 * proposal (`proposeGuardExit` / `proposeExit`, disposed by the gate's rule) or
 * a harness-authority proposal (`proposeHarnessExit`: accepted outright,
 * exactly as these sites used to end the run themselves) — and returns the
 * gate's `ExitDisposition`. The turn runner (`runKernelTurn`) maps it to
 * the pass signal. No operation returns `"break"` (the type forbids it; pinned).
 *
 * Three heavy blocks delegate to named phase-step helpers under `runner-helpers/`:
 *   · `applyStrategySwitch`     — reinit for a new strategy + reset counters
 *                                 (shared by dispatcher + loop-detector switch).
 *   · `runStallDeliverableStep` — harness stall / deliverable decision tree.
 *   · `resolveDetectedLoop`     — confirmed-loop recovery / deliver / fail tree.
 */
import { Effect } from "effect";
import { modelSynthesisDeliverable, sentinelDeliverable } from "@reactive-agents/core";
import { pendingHandoff, proposeGuardExit, proposeHarnessExit } from "./exit-gate.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { authorityOf } from "../capabilities/decide/authority.js";
import { transitionState } from "../state/kernel-state.js";
import { applyStrategySwitch } from "./runner-helpers/strategy-switch.js";
import { openSignal } from "../state/signal-ledger.js";
import { runStallDeliverableStep } from "./runner-helpers/stall-deliverable.js";
import {
  assessmentFailuresAreArgVarying,
  assessmentIsGatheringPhase,
  isMetaOnlyPass,
  nextLowDeltaCount,
  nextStalledCount,
} from "../assessment/guard-adapters.js";
import { resolveDetectedLoop } from "./runner-helpers/loop-resolution.js";
import { detectLoopPattern, lastDeliverableText } from "../capabilities/reflect/loop-detector.js";
import { buildOracleNudge } from "../capabilities/decide/oracle-nudge.js";
import { shouldInjectOracleNudge } from "../utils/lane-controller.js";
import { emitGuardFired, emitHarnessSignalInjected } from "../utils/diagnostics.js";
import { recompileOnAssessment } from "../policy/harness-plan.js";
import { recordHarnessRecompiled } from "../ledger/emit.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
  detectRepeatedIdenticalToolFailure,
} from "./runner-helpers/recovery-steering.js";
import {
  TIER_GUARD_THRESHOLDS,
  shouldExitOnLowDelta, lowDeltaEvidence,
  shouldForceOracleExit, oracleForcedEvidence,
} from "./runner-helpers/tier-guards.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import {
  countDeliverableCandidates,
  passthroughOutputDeliverable,
  unproducedDeliverables,
} from "./runner-helpers/deliverable.js";
import {
  passStartAssessment,
  zeroEvidenceStandDownWithEvidence,
  applyE3PaceActions, staleIterationsAtTurnBoundary,
} from "./iterate-assessment-seam.js";
import {
  resolveF3ControlPlane,
  resolveStallControlPlane,
  resolveSwitchControlPlane,
} from "./iterate-control-plane-seams.js";
import { resolveLoopSwitchEvaluation } from "./iterate-loop-switch-seam.js";
import type { SeamOperationName, TurnOperationImpls } from "./turn-operations.js";

/** The guard and control operations (see the file header). */
export const GUARD_TURN_OPERATIONS: Omit<TurnOperationImpls, SeamOperationName> = {
  "assess-pass-start": (t, cfg) =>
    Effect.gen(function* () {
      const { requiredTools, horizon, emitLog } = cfg;
      // RunAssessment (meta-loop Phase 5a / task E1) — the perception node: where
      // the run stands from contract × ledger × budget, cached on
      // state.meta.assessment. Plan 9 item 9: a pass computes it ONCE, after its act
      // (assessAfterAct below the kernel step); these pass-start readers reuse the
      // previous pass's value, and only a state with none yet takes a seed here.
      // Guarded on a compiled RunContract (the goal input assess() needs).
      const contract = t.state.meta.runContract;
      if (contract) {
        const assessed = yield* passStartAssessment({ state: t.state, contract, currentOptions: t.currentOptions });
        t.state = assessed.state;
        const assessment = assessed.assessment;
        t.pass.evidenceStaleIterations = assessed.evidenceStaleIterations;

        // ── W4-live: default-on zero-evidence stand-down ────────────────────
        // FLAIL discriminator decomposed verbatim to ./iterate-assessment-seam.ts
        // (quality Task 9); the honest abstain is a harness-authority proposal
        // the exit gate accepts through the single-owner terminate()
        // (check-termination-paths) — the F1/P5 precedence rationale travels
        // with the helper.
        const reason = yield* zeroEvidenceStandDownWithEvidence({
          state: t.state, assessment, evidenceStaleIterations: t.pass.evidenceStaleIterations,
          requiredTools, horizon, currentOptions: t.currentOptions,
        });
        if (reason !== null) {
          return proposeHarnessExit(t.state, {
            proposedBy: "harness",
            end: {
              via: "terminate",
              options: {
                reason: "abstained",
                deliverable: sentinelDeliverable("no_substantive_output", reason),
                extraMeta: {
                  abstention: { reason, missing: [] },
                  // The output is a harness-authored sentinel, not a model answer:
                  // mark it so resolveCompletionStatus does not report "completed"
                  // for an abstention (honest partial at the strategy boundary; the
                  // engine maps terminatedBy:"abstained" → failure regardless).
                  harnessAuthoredOutput: true,
                },
              },
            },
          });
        }

        // ── HarnessPlan mid-run recompile (meta-loop Phase 6 / task G1) ──────
        // The adaptive lever: on a cadence, recompile the run's HarnessPlan from
        // the just-computed assessment — DEEPEN scaffolding when the run is
        // struggling (repeated failures / no new evidence), LEAN when it flows.
        // OPT-IN behind `.withAdaptiveHarness()`; OFF (default, no
        // `meta.harnessPlan`) → this whole block is skipped → byte-identical.
        // DAG-safe: a pure READ of the assessment (E1); the only writes are the
        // updated plan on meta + a logged `harness-signal` ledger entry. Bounded
        // by recompileOnAssessment (one step/call, scaffolding clamped) AND the
        // cadence gate below. Cadence 3 = responsive without recomputing the
        // plan every iteration (the assessment itself is already per-iteration).
        const HARNESS_RECOMPILE_CADENCE = 3;
        if (
          t.currentOptions.adaptiveHarness === true &&
          t.state.meta.harnessPlan &&
          t.state.iteration > 0 &&
          t.state.iteration % HARNESS_RECOMPILE_CADENCE === 0
        ) {
          const recompiled = recompileOnAssessment(t.state.meta.harnessPlan, assessment);
          if (recompiled.changed) {
            const ledgerWithSignal = recordHarnessRecompiled(
              t.state.ledger,
              t.state.iteration,
              recompiled.reason,
            );
            t.state = transitionState(t.state, {
              ledger: ledgerWithSignal,
              meta: {
                ...t.state.meta,
                harnessPlan: recompiled.plan,
                // Escalate the live horizon profile when the recompile deepened
                // it (read by the RI observer). Deescalation of the already-
                // resolved guard bundle mid-run is out of scope — the leaner
                // plan still stands on meta for downstream/receipt consumers.
                ...(recompiled.plan.guard.horizonProfile
                  ? { horizonProfile: recompiled.plan.guard.horizonProfile }
                  : {}),
              },
            });
          }
        }

        // ── E3 pace ACTIONS — turn the just-computed pace band into actuator
        // actions. Decomposed verbatim to ./iterate-assessment-seam.ts
        // (quality program Task 9).
        const pace = yield* applyE3PaceActions({
          state: t.state, contract, assessment, currentInput: t.currentInput, currentOptions: t.currentOptions,
          horizon, emitLog,
        });
        t.state = pace.state;
        if (pace.exit) {
          return pace.exit;
        }
      }
      return "next";
    }),

  "grounding-redirect-trace": (t) =>
    Effect.gen(function* () {
      // ── F1 — grounded-terminal redirect trace (2026-07-02) ───────────────
      // The Arbitrator's grounded-terminal gate is pure (it appends the
      // harness_signal step and bumps meta.groundingRedirectCount inside
      // applyTermination); the runner owns the diagnostics emission. A bump
      // during this pass means the gate rejected an ungrounded terminal —
      // surface it on the same harness-signal-injected trace path the
      // stall/loop recovery redirects use, so rax:diagnose sees it.
      if ((t.state.meta.groundingRedirectCount ?? 0) > t.pass.groundingRedirectsAtPassStart) {
        const redirectSignal = [...t.state.steps]
          .reverse()
          .find((s) => s.type === "harness_signal");
        const signalContent = redirectSignal?.content ?? "grounded-terminal redirect";
        // Signal consumption edge (2026-10-25): open a ledger entry + pending
        // ref so the render/effect chain can track this steer.
        const opened = openSignal(t.state.signalLedger ?? [], {
          signalKind: "redirect",
          origin: "capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate",
          target: { policy: "synthesize" },
          iter: t.state.iteration,
          content: signalContent,
        });
        const priorRefs = t.state.pendingGuidance?.pendingSignals ?? [];
        t.state = transitionState(t.state, {
          signalLedger: opened.ledger,
          pendingGuidance: {
            ...(t.state.pendingGuidance ?? {}),
            errorRecovery: signalContent,
            pendingSignals: [...priorRefs, { signalId: opened.signalId, field: "errorRecovery", target: { policy: "synthesize" } }],
          },
        });
        const signalId = opened.signalId;
        yield* emitHarnessSignalInjected({
          taskId: t.currentOptions.taskId ?? t.state.taskId,
          iteration: t.state.iteration,
          signalKind: "redirect",
          origin: "capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate",
          content: signalContent,
          signalId,
          targetPolicy: "synthesize",
          metadata: {
            trigger: "grounded-terminal",
            groundingRedirectCount: t.state.meta.groundingRedirectCount,
            requiredTools: t.currentInput.requiredTools ?? [],
          },
        });
        // The redirect IS this pass's steering — short-circuit to the next
        // iteration (same "next" pattern as the stall/loop recovery paths) so
        // the stall guard cannot stack a SECOND recovery signal onto the same
        // pass and the run stays capped at ONE grounding redirect end-to-end.
        return "continue";
      }
      return "next";
    }),

  "low-delta-guard": (t, cfg) =>
    Effect.gen(function* () {
      const { tierGuards, horizon, profile } = cfg;
      // ── Token-delta diminishing-returns guard ────────────────────────────
      // Track consecutive iterations where the model adds fewer than the
      // tier-specific token threshold. After 2 such iterations (starting from
      // iteration 3), exit early to prevent wasted iterations on a stalled model.
      // Guard is skipped when no LLM calls have been made (e.g. test/mock kernels
      // that emit 0 tokens) to avoid false positives in non-LLM scenarios.
      const prevTokens = t.pass.prevTokens;
      const tokenDelta = t.state.tokens - prevTokens;
      if (t.state.tokens > 0 || prevTokens > 0) {
        const lowDelta = tokenDelta < tierGuards.tokenDeltaThreshold;
        // E2 (audit 02-#3): a successful NEW gather is progress — token delta
        // alone is blind to tool successes. Under the long-horizon profile, a
        // low-delta iteration that produced new substantive evidence
        // (assessment.evidenceDelta > 0) does NOT accrue toward the exit; the
        // counter resets. OFF → byte-identical to the legacy expression.
        const newConsecutiveLowDelta = nextLowDeltaCount(
          t.state.consecutiveLowDeltaCount ?? 0,
          lowDelta,
          horizon !== undefined,
          t.state.meta.assessment,
        );
        t.state = transitionState(t.state, { consecutiveLowDeltaCount: newConsecutiveLowDelta });

        // Only fire the guard when there are remaining iterations to save
        // (if we're already at the last iteration, the loop exits naturally).
        const hasRemainingIterations = t.state.iteration < t.currentOptions.maxIterations - 1;
        const missingRequiredForLowDelta = missingRequiredToolsForInput(t.state, t.currentInput);
        // A declared deliverable that has not been produced is the same class of
        // "the run is not done" fact as a required tool that has not been
        // called — and it is the one the RunContract exists to state. Nothing
        // consulted it, so this guard could end a run whose entire point was to
        // write a file it had not written: bench rw-4 (2026-07-26) fetched the
        // posts, fetched the comments and computed the enriched array, then was
        // terminated on tokenDelta 0 with artifactsAvailable 4, before writing
        // the required output.ts. maxIterations still bounds the run; this only
        // declines the EARLY exit while the contract is demonstrably unmet.
        const unproducedForLowDelta = unproducedDeliverables(t.state);
        if (
          hasRemainingIterations &&
          missingRequiredForLowDelta.length === 0 &&
          unproducedForLowDelta.length === 0 &&
          t.state.status !== "done" &&
          t.state.status !== "failed" &&
          shouldExitOnLowDelta({ iteration: t.state.iteration, tokenDelta, consecutiveLowDeltaCount: newConsecutiveLowDelta, tier: profile.tier })
        ) {
          yield* Effect.log(`[token-delta-guard] Early exit: 2 consecutive iterations with <${tierGuards.tokenDeltaThreshold} token delta (delta=${tokenDelta}, iter=${t.state.iteration})`);
          yield* emitGuardFired({
            taskId: t.currentOptions.taskId ?? t.state.taskId,
            iteration: t.state.iteration,
            guard: "low_delta_guard",
            outcome: "terminate",
            reason: "low_delta",
            metadata: {
              consecutiveLowDeltaCount: newConsecutiveLowDelta,
              artifactsAvailable: countDeliverableCandidates(t.state),
              ...lowDeltaEvidence({ tokenDelta, consecutiveLowDeltaCount: newConsecutiveLowDelta, tier: profile.tier }),
            },
          });
          // Plan 8 item 3: a proposal; the exit gate disposes.
          return yield* proposeGuardExit(t.state, "low_delta_guard", "low_delta_guard", passthroughOutputDeliverable(t.state.output), t.currentInput, t.currentOptions);
        }
      }
      return "next";
    }),

  "dispatcher-strategy-switch": (t, cfg) =>
    Effect.gen(function* () {
      const { options, context, hooks } = cfg;
      // Honor dispatcher-requested strategy switch
      if (t.state.meta.terminatedBy === "dispatcher-strategy-switch") {
        const pending = t.state.meta.dispatchedStrategySwitch;
        const switchCfg = options.strategySwitching;
        const maxSwitches = switchCfg?.maxSwitches ?? 1;
        if (pending && switchCfg?.enabled && t.switchCount < maxSwitches) {
          const fromStrategy = t.triedStrategies[t.triedStrategies.length - 1] ?? t.currentOptions.strategy ?? "unknown";
          const switchResult = yield* applyStrategySwitch({
            state: t.state,
            currentInput: t.currentInput,
            context,
            options,
            hooks,
            triedStrategies: t.triedStrategies,
            switchCount: t.switchCount,
            fromStrategy,
            toStrategy: pending.to,
            failureReason: pending.reason,
          });
          t.state = switchResult.state;
          t.currentInput = switchResult.currentInput;
          t.currentContext = switchResult.currentContext;
          t.currentOptions = switchResult.currentOptions;
          t.switchCount = switchResult.switchCount;
          ({
            prevActionCount: t.prevActionCount,
            requiredToolRedirects: t.requiredToolRedirects,
            consecutiveStalled: t.consecutiveStalled,
            prevArtifactCount: t.prevArtifactCount,
            failureRecoveryRedirects: t.failureRecoveryRedirects,
          } = switchResult.resetCounters);
          return "continue";
        }
        // Switching not enabled or exhausted — deliver what we have
        return yield* proposeGuardExit(t.state, "switching_exhausted", "switching_exhausted", passthroughOutputDeliverable(t.state.output), t.currentInput, t.currentOptions);
      }
      return "next";
    }),

  "repeated-failure-redirect": (t, cfg) =>
    Effect.gen(function* () {
      const { horizon, requiredTools, maxFailureRecoveryRedirects } = cfg;
      // ── F3 — repeated-identical-failure escalation (2026-07-02) ──────────
      // Bench root cause (cogito:8b rw-8): the model repeated the SAME
      // malformed call 4×, got 4 identical errors, then shipped a guess.
      // Recovery steering existed but only fired via the stall (iter ≥ 2) or
      // loop guards — several wasted iterations later. Here: same tool + same
      // normalized error class ≥2 consecutive failures → inject the SAME
      // recovery steering immediately. Guards:
      //   - the trailing failure landed THIS pass (no re-fire on a stale streak),
      //   - the tool is a real registered tool (never pseudo-observations like
      //     "system"/"completion-guard" guard feedback),
      //   - shared redirect budget (failureRecoveryRedirects) not exhausted,
      //   - run still live (a terminal reached this pass is never reopened).
      if (t.state.status !== "done" && t.state.status !== "failed") {
        const repeated = detectRepeatedIdenticalToolFailure(t.state.steps);
        const knownToolNames = new Set(
          (t.currentInput.availableToolSchemas ?? []).map((s) => s.name),
        );
        // E2 (audit 02-#11): the F3 error class is arg-INSENSITIVE — it fires on
        // (tool, errorClass) alone, so a model VARYING its arguments across
        // failures (genuinely exploring fixes) gets the same immediate redirect
        // as one blindly repeating a single bad call. Under the long-horizon
        // profile, when the arg-normalized failure signal shows varying args
        // (assessment.health.failureArgVariety > 1) suppress the immediate F3
        // redirect and let the model keep searching. OFF → byte-identical.
        const f3ArgVarying = assessmentFailuresAreArgVarying(horizon !== undefined, t.state.meta.assessment);
        if (
          repeated !== null &&
          repeated.lastIndex >= t.pass.stepsAtPassStart &&
          knownToolNames.has(repeated.toolName) &&
          t.failureRecoveryRedirects < maxFailureRecoveryRedirects &&
          !f3ArgVarying
        ) {
          const repeatedRecovery = getToolFailureRecovery(t.state, t.currentInput);
          if (repeatedRecovery.failedUnresolved.length > 0) {
            // The redirect this seam WANTS. Built before the control plane runs so
            // it can be offered as a proposal rather than forced; the counter is
            // only committed if the redirect actually wins (below).
            const prospectiveRedirects = t.failureRecoveryRedirects + 1;
            const guidance = buildRecoverySteeringGuidance(
              repeatedRecovery,
              prospectiveRedirects,
              maxFailureRecoveryRedirects,
              "stall",
            );

            if (horizon !== undefined) {
              // Control plane (F3 seam) — resolve redirect vs abstain. Decomposed
              // verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
              const f3Plane = yield* resolveF3ControlPlane({
                state: t.state,
                currentInput: t.currentInput,
                requiredTools,
                currentOptions: t.currentOptions,
                horizon,
                repeated,
                repeatedRecovery,
                guidance,
              });
              t.state = f3Plane.state;
              if (f3Plane.exit) {
                return f3Plane.exit;
              }
            }

            t.failureRecoveryRedirects++;
            const recoveryTargetPolicy =
              (repeatedRecovery?.alternativeCandidates?.length ?? 0) > 0
                ? ("alternate-tool" as const)
                : ("denied-tool-retry" as const);
            const recoveryTargetTool =
              (repeatedRecovery?.alternativeCandidates?.[0] as string | undefined) ??
              repeated.toolName;
            const openedRecovery = openSignal(t.state.signalLedger ?? [], {
              signalKind: "redirect",
              origin: "loop/iterate-pass.ts:710:repeated-identical-failure",
              target: { tool: recoveryTargetTool, policy: recoveryTargetPolicy },
              iter: t.state.iteration,
              content: guidance,
            });
            const priorRefs = t.state.pendingGuidance?.pendingSignals ?? [];
            t.state = transitionState(t.state, {
              signalLedger: openedRecovery.ledger,
              pendingGuidance: {
                ...(t.state.pendingGuidance ?? {}),
                errorRecovery: guidance,
                pendingSignals: [...priorRefs, { signalId: openedRecovery.signalId, field: "errorRecovery", target: { tool: recoveryTargetTool, policy: recoveryTargetPolicy } }],
              },
            });
            yield* emitHarnessSignalInjected({
              taskId: t.currentOptions.taskId ?? t.state.taskId,
              iteration: t.state.iteration,
              signalKind: "redirect",
              origin: "loop/iterate-pass.ts:710:repeated-identical-failure",
              content: guidance,
              signalId: openedRecovery.signalId,
              targetTool: recoveryTargetTool,
              targetPolicy: recoveryTargetPolicy,
              metadata: {
                trigger: "repeated-identical-failure",
                toolName: repeated.toolName,
                errorClass: repeated.errorClass,
                streak: repeated.streak,
                redirectCount: t.failureRecoveryRedirects,
              },
            });
            t.state = transitionState(t.state, {
              status: "thinking",
              steps: [
                ...t.state.steps,
                makeStep("harness_signal", `⚠️ ${guidance}`, {
                  // Spec §5b (W-Q) — the F3 immediate redirect is a
                  // receipt-visible intervention. Deterministic: an exact
                  // (tool, errorClass) repeat is an evidence-driven fact.
                  intervention: {
                    actor: "repeated-identical-failure",
                    authorityClass: authorityOf("repeated-identical-failure"),
                    evidence: `${repeated.toolName} failed ${repeated.streak}× with errorClass=${repeated.errorClass}`,
                    whatChanged: "repeated-identical-failure: injected recovery steering",
                    iter: t.state.iteration,
                  },
                }),
              ],
              pendingGuidance: {
                ...(t.state.pendingGuidance ?? {}),
                errorRecovery: guidance,
              },
              error: null,
            });
            return "continue";
          }
        }
      }
      return "next";
    }),

  stall: (t, cfg) =>
    Effect.gen(function* () {
      const {
        services, horizon, requiredTools, maxRequiredToolNudges, maxFailureRecoveryRedirects, verifier, emitLog,
      } = cfg;
      const { toolsThisStep, laneDecision } = t.pass;
      // ── Harness artifact stall tracking ─────────────────────────────────
      // Track whether this iteration produced new non-meta tool observations.
      // The harness owns completion: when the model stalls but has gathered
      // useful data, it assembles and delivers the accumulated artifacts.
      const totalArtifacts = countDeliverableCandidates(t.state);
      const artifactDelta = Math.max(0, totalArtifacts - t.prevArtifactCount);
      // E2 (audit 02-#3 stall staleness): the stall counter tracked new
      // deliverable ARTIFACTS only; under the long-horizon profile new evidence
      // (evidenceDelta > 0) also resets. Plan 9 2a (all paths): a META-ONLY pass
      // (executed or think-queued calls) HOLDS the count; churn is not a stall.
      t.consecutiveStalled = nextStalledCount(
        t.consecutiveStalled,
        artifactDelta,
        horizon !== undefined,
        t.state.meta.assessment,
        isMetaOnlyPass(toolsThisStep, t.state.status === "acting" ? t.state.meta.pendingNativeToolCalls : undefined),
      );
      t.prevArtifactCount = totalArtifacts;

      // When reactive intelligence is active it needs at least iteration 2 before it
      // can evaluate early-stop. Give it runway by raising the stall threshold to 4
      // so the RI evaluator always gets a chance to act before the harness fires.
      // Detection is purely structural — `services.reactiveController._tag === "Some"`
      // avoids importing anything from the reactive-intelligence package.
      const riActive = services.reactiveController._tag === "Some";
      // A2 — under the long-horizon profile the stall threshold scales with
      // maxIterations (max(2, 10% of maxIter); RI floor 4). Off → literals 4/2.
      const stallThreshold = riActive
        ? (horizon?.stallThresholdRI ?? 4)
        : (horizon?.stallThreshold ?? 2);

      const stallTriggered =
        t.consecutiveStalled >= stallThreshold &&
        t.state.iteration >= 2 &&
        t.state.status === "thinking";

      // ── Control plane (stall seam) — resolve steer vs abstain ───────────────
      // Decomposed verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
      if (horizon !== undefined && stallTriggered) {
        const stallPlane = yield* resolveStallControlPlane({
          state: t.state, currentInput: t.currentInput, requiredTools, currentOptions: t.currentOptions, horizon, laneDecision,
        });
        t.state = stallPlane.state;
        if (stallPlane.exit) {
          return stallPlane.exit;
        }
      }
      const stallResult = yield* runStallDeliverableStep({
        state: t.state,
        currentInput: t.currentInput,
        currentOptions: t.currentOptions,
        missingRequiredByCount: laneDecision.missingRequiredTools,
        stallTriggered,
        totalArtifacts,
        consecutiveStalled: t.consecutiveStalled, stallThreshold,
        requiredToolNudgeCount: t.requiredToolNudgeCount,
        failureRecoveryRedirects: t.failureRecoveryRedirects,
        maxRequiredToolNudges,
        maxFailureRecoveryRedirects,
        verifier,
        emitLog,
        horizonIgnoredNudgeTolerance: horizon?.ignoredNudgeTolerance,
        // E2 (audit 02-#6): a gathering-phase non-write must not count as an
        // "ignored" required-tool nudge — the run is legitimately still
        // collecting inputs before it can call a terminal write tool. OFF →
        // false → the ignored-nudge definition is byte-identical.
        gatheringPhase: assessmentIsGatheringPhase(horizon !== undefined, t.state.meta.assessment),
      });
      t.state = stallResult.state;
      t.requiredToolNudgeCount = stallResult.requiredToolNudgeCount;
      t.failureRecoveryRedirects = stallResult.failureRecoveryRedirects;
      if (stallResult.exit) { return stallResult.exit; }
      if (stallResult.outcome === "next") { return "continue"; }
      return "next";
    }),

  "oracle-gate": (t, cfg) =>
    Effect.gen(function* () {
      const { profile, horizon, emitLog } = cfg;
      const { laneDecision, oracleReady } = t.pass;
      // ── Oracle hard gate (pulse readyToAnswer two-stage escalation) ──────
      // When the pulse tool has reported readyToAnswer=true but the model
      // has not called final-answer, escalate in two stages:
      //   Stage 1: inject a mandatory steering nudge, increment nudge count.
      //   Stage 2: after N ignored nudges (tier-dependent), force-exit with "oracle_forced".
      if (t.state.status !== "done" && t.state.status !== "failed") {
        const nudgeCount = t.state.readyToAnswerNudgeCount ?? 0;
        // A2 — effective oracle nudge limit: tier base + long-horizon bonus (0
        // when the profile is off → tier base, byte-identical). Computed once so
        // the force-exit gate and the nudge builder's "last chance" footer agree.
        const effectiveOracleNudgeLimit =
          (TIER_GUARD_THRESHOLDS[profile.tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).oracleNudgeLimit +
          (horizon?.oracleNudgeBonus ?? 0);
        const shouldNudgeForOracle = shouldInjectOracleNudge({
          lane: laneDecision.lane,
          oracleReady,
        });

        if (
          shouldNudgeForOracle &&
          shouldForceOracleExit({
            oracleReady,
            readyToAnswerNudgeCount: nudgeCount,
            tier: profile.tier,
            nudgeLimitOverride: effectiveOracleNudgeLimit,
          })
        ) {
          // Stage 2: force exit — model has been nudged twice and still hasn't called final-answer
          yield* emitGuardFired({
            taskId: t.currentOptions.taskId ?? t.state.taskId,
            iteration: t.state.iteration,
            guard: "oracle_forced",
            outcome: "terminate",
            reason: "oracle_forced",
            metadata: {
              nudgeCount, ...oracleForcedEvidence(nudgeCount, effectiveOracleNudgeLimit),
              willDeliver: !!(
                t.state.output ??
                lastDeliverableText(t.state.steps)
              )?.trim(),
            },
          });
          yield* emitLog({ _tag: "warning", message: `[oracle-gate] Forcing exit after ${nudgeCount} ignored readyToAnswer signals`, timestamp: new Date() });
          // Plan 8 item 3: a proposal to the exit gate. Model text → model_synthesis;
          // no text → a sentinel the gate denies once or hands off (never a bare fail).
          // The disposition ends the pass like every other guard's: a later
          // operation (required-tools-guard) must not reopen a run the gate ended.
          const oracleForcedOutput = t.state.output ?? lastDeliverableText(t.state.steps);
          return yield* proposeGuardExit(t.state, "oracle_forced", "oracle_forced", oracleForcedOutput && oracleForcedOutput.trim().length > 0
            ? modelSynthesisDeliverable({ type: "thought", content: oracleForcedOutput, iteration: t.state.iteration })
            : sentinelDeliverable("no_substantive_output", "oracle forced exit"), t.currentInput, t.currentOptions,
            { error: `Oracle forced exit after ${nudgeCount} ignored readyToAnswer signals, but the model never produced a deliverable answer.`, stampReason: true });
        } else if (shouldNudgeForOracle) {
          // Stage 1: inject mandatory oracle guidance, increment count.
          //
          // The nudge text is composed by the Layer 1 intelligent default
          // builder `buildOracleNudge` (Spec: 2026-05-06-intelligent-default-builders).
          // The builder owns the M3 Pivot B "describe vs emit" example
          // pair and the final-attempt escalation footer.
          const mandatoryNudge = buildOracleNudge({
            nudgeCount,
            nudgeLimit: effectiveOracleNudgeLimit,
          });
          t.state = transitionState(t.state, {
            readyToAnswerNudgeCount: nudgeCount + 1,
            pendingGuidance: { oracleGuidance: mandatoryNudge },
          });
          yield* emitLog({ _tag: "warning", message: `[oracle-gate] Stage 1 nudge injected (nudgeCount now ${nudgeCount + 1})`, timestamp: new Date() });
        } else if (nudgeCount > 0) {
          // Oracle no longer eligible for synthesis nudges — reset count.
          // This includes both "oracle not ready" and gather-lane runs.
          t.state = transitionState(t.state, { readyToAnswerNudgeCount: 0 });
        }
      }
      return "next";
    }),

  "loop-detection": (t, cfg) =>
    Effect.gen(function* () {
      const {
        options, context, hooks, horizon, requiredTools, emitLog,
        maxSameTool, maxRepeatedThought, maxConsecutiveThoughts, maxFailureRecoveryRedirects, maxRequiredToolNudges,
      } = cfg;
      // ── Loop detection + strategy switching ─────────────────────────────
      // Only at a TURN boundary: not terminated, and not "acting" (the turn's thought is in, its pending calls' action steps are not — a
      // streak counted here drops the calls on a switch; H3 tool-call-dropped). Act runs next pass; detection then sees the action.
      if (t.state.status !== "done" && t.state.status !== "failed" && t.state.status !== "acting") {
        const detection = detectLoopPattern(
          t.state.steps,
          maxSameTool,
          maxRepeatedThought,
          maxConsecutiveThoughts,
          { evidenceStaleIterations: staleIterationsAtTurnBoundary(t.state.meta.assessment, t.pass.evidenceStaleIterations), posture: t.currentInput.posture },
        );
        const loopMsg = detection?.message ?? null;

        // ── Strategy switching ────────────────────────────────────────────
        if (loopMsg !== null) {
          const switchCfg = options.strategySwitching;
          const maxSwitches = switchCfg?.maxSwitches ?? 1;

          if (switchCfg?.enabled && t.switchCount < maxSwitches) {
            // Transition to "evaluating" while we decide
            t.state = transitionState(t.state, { status: "evaluating" });

            const evaluation = yield* resolveLoopSwitchEvaluation({
              state: t.state, switchCfg, currentInput: t.currentInput, triedStrategies: t.triedStrategies,
            });

            // Fire evaluated hook regardless of whether switch will happen — observability
            yield* hooks.onStrategySwitchEvaluated(t.state, evaluation);

            if (evaluation.shouldSwitch && evaluation.recommendedStrategy) {
              if (horizon !== undefined) {
                // Control plane (F1) — switch vs abstain (the P5 fix). Decomposed
                // verbatim to ./iterate-control-plane-seams.ts (quality Task 9).
                const switchPlane = yield* resolveSwitchControlPlane({
                  state: t.state, currentInput: t.currentInput, requiredTools, currentOptions: t.currentOptions, horizon,
                });
                t.state = switchPlane.state;
                if (switchPlane.exit) {
                  return switchPlane.exit;
                }
              }
              const fromStrategy = t.triedStrategies[t.triedStrategies.length - 1] ?? "unknown";
              const switchResult = yield* applyStrategySwitch({
                state: t.state,
                currentInput: t.currentInput,
                context,
                options,
                hooks,
                triedStrategies: t.triedStrategies,
                switchCount: t.switchCount,
                fromStrategy,
                toStrategy: evaluation.recommendedStrategy,
                failureReason:
                  detection !== null
                    ? `pattern=${detection.pattern.id} (${detection.pattern.name}); ${detection.message}`
                    : loopMsg,
              });
              t.state = switchResult.state;
              t.currentInput = switchResult.currentInput;
              t.currentContext = switchResult.currentContext;
              t.currentOptions = switchResult.currentOptions;
              t.switchCount = switchResult.switchCount;
              ({
                prevActionCount: t.prevActionCount,
                requiredToolRedirects: t.requiredToolRedirects,
                consecutiveStalled: t.consecutiveStalled,
                prevArtifactCount: t.prevArtifactCount,
                failureRecoveryRedirects: t.failureRecoveryRedirects,
              } = switchResult.resetCounters);

              // Continue the outer while loop with fresh state
              return "continue";
            }
          }

          // No switch taken (disabled / exhausted / evaluator declined) — resolve
          // the confirmed loop via the recovery / deliver / fail tree. Always
          // ends the pass: the gate's disposition when it proposed an exit, else
          // "continue" (a recovery redirect or nudge was injected).
          const loopResult = yield* resolveDetectedLoop({
            state: t.state,
            currentInput: t.currentInput,
            currentOptions: t.currentOptions,
            loopMsg, detection,
            failureRecoveryRedirects: t.failureRecoveryRedirects,
            requiredToolNudgeCount: t.requiredToolNudgeCount,
            maxFailureRecoveryRedirects,
            maxRequiredToolNudges,
            emitLog,
          });
          t.state = loopResult.state;
          t.failureRecoveryRedirects = loopResult.failureRecoveryRedirects;
          t.requiredToolNudgeCount = loopResult.requiredToolNudgeCount;
          return loopResult.exit ?? "continue";
        }
      } // end if (state.status !== "done" && state.status !== "failed")
      return "next";
    }),

  "required-tools-guard": (t, cfg) => {
    const { requiredTools, maxRequiredToolRetries } = cfg;
    // ── Required tools guard (in-loop) ─────────────────────────────────
    // When the kernel declares "done" but required tools haven't been called,
    // redirect back to "thinking" with a feedback step — up to the retry limit.
    //
    // Durable HITL (Phase D): an `awaiting-approval` pause is NOT a missing
    // required tool — the gated tool WAS requested and the run is intentionally
    // suspended before executing it. Without this exemption the auto-required-
    // tools redirect re-thinks the gated call every iteration (the gate re-fires,
    // the tool never "executes") and the run loops to max_iterations instead of
    // pausing. Resume executes the approved call, satisfying the requirement.
    // Durable pause (Task 9): an `awaiting-interaction` pause is the identical
    // case — the model asked for human input via `request_user_input` and the
    // run is intentionally suspended, not missing a required tool.
    // Exit gate handoff: the gate already weighed the missing tools (they are
    // on its outstanding list) and ended the run; its disposition is final.
    // A handoff minted inside the think step (controller early stop) reaches
    // here as state, not as a returned disposition, so it is checked here.
    if (
      t.state.status === "done" &&
      requiredTools.length > 0 &&
      t.state.meta.terminatedBy !== "awaiting-approval" &&
      t.state.meta.terminatedBy !== "awaiting-interaction" &&
      pendingHandoff(t.state) === undefined
    ) {
      const missingTools = missingRequiredToolsForInput(t.state, t.currentInput);
      if (missingTools.length > 0) {
        t.requiredToolRedirects++;
        if (t.requiredToolRedirects > maxRequiredToolRetries) {
          // The quota is spent: a harness-authority exit the gate accepts as the
          // honest failure it always was.
          return Effect.succeed(proposeHarnessExit(t.state, {
            proposedBy: "harness",
            end: {
              via: "fail",
              error: `Task incomplete — the model never called required tool(s): ${missingTools.join(", ")} ` +
                `(after ${maxRequiredToolRetries} redirect attempts).\n` +
                `Fix: (1) Make the task description explicitly name the expected output ` +
                `(e.g. "write the result to ./report.md"), ` +
                `(2) Add a persona instruction: "You MUST call ${missingTools[0]} as the final step", ` +
                `(3) Increase retries: .withReasoning({ maxRequiredToolRetries: 4 }).`,
            },
          }));
        }
        // Inject feedback and redirect back to thinking
        const feedbackStep = makeStep(
          "observation",
          `⚠️ Required tools not yet used: ${missingTools.join(", ")}. ` +
          `You MUST call ${missingTools.length === 1 ? "this tool" : "these tools"} before completing the task. ` +
          `(Redirect ${t.requiredToolRedirects}/${maxRequiredToolRetries})`,
        );
        t.state = transitionState(t.state, {
          status: "thinking",
          output: null,
          steps: [...t.state.steps, feedbackStep],
        });
        // Continue the loop — kernel will see the feedback in steps
      }
    }
    return Effect.succeed("next");
  },
};
