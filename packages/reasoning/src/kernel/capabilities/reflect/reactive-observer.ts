/**
 * Reactive Observer — entropy scoring and reactive controller evaluation.
 *
 * Runs after each kernel step (post-kernel, pre-loop-detection) to:
 *   1. Score the latest thought through the EntropySensor and append to entropyHistory
 *   2. Evaluate the reactive controller and accumulate controllerDecisions/controllerDecisionLog
 *
 * Extracted from kernel-runner.ts to keep the main loop focused on iteration logic.
 */
import { Effect, Option } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { transitionState, asKernelStateLike } from "../../../kernel/state/kernel-state.js";
import type { KernelState, KernelRunOptions, EventBusInstance } from "../../../kernel/state/kernel-state.js";
import { appendGuidanceText } from "../../state/guidance-channel.js";
import type { StrategyServices } from "../../../kernel/utils/service-utils.js";
import type { EntropyScoreLike } from "../../../kernel/loop/output-assembly.js";
import type { HarnessPipeline } from "@reactive-agents/core";
import { toolFailureStreak, toolCallArgsKey } from "./tool-failure-streak.js";

/** RI `ControllerNotice` tag: the near-cap early-stop stood down for progress. */
const EARLY_STOP_WITHHELD = "early-stop-withheld";

/** Kernel signals the observer forwards to the reactive controller. */
export interface ReactiveObserverSignals {
  /** Compose pipeline, for the dispatcher's RI→Compose bridge (HS-112). */
  readonly harnessPipeline?: HarnessPipeline;
  /**
   * The kernel's running `failureRecoveryRedirects` carry count (RC-3 fix). The kernel's
   * repeated-identical-failure streak redirect is the single trigger authority for
   * "the agent is stuck"; RI's strategy-switch evaluator only escalates a stall the
   * kernel has already acted on. Omitted → RI fails closed (no strategy switch).
   *
   * Scope note: this counter only increments on unresolved TOOL failure
   * recovery (`recovery.failedUnresolved.length > 0`) — RI's entropy
   * switch-strategy evaluator is therefore unreachable for thought-only loops,
   * or for tool calls that succeed but return unproductive results.
   */
  readonly redirectsIssued?: number;
  /**
   * True when the run can still switch strategy (switching enabled and not
   * exhausted). Forwarded so RI proposes no switch it cannot make: the
   * dispatcher-strategy-switch turn op turns an unhonorable request into a
   * `switching_exhausted` exit (RI census 2026-11-06: 5 of 13 dispatches).
   * Omitted → RI keeps its prior behavior.
   */
  readonly switchingAvailable?: boolean;
}

/**
 * Compute the adaptive entropy floor for the intervention suppression gate.
 *
 * Priority:
 *  1. calibrated (≥20 samples): relative to the model's own high-entropy mark
 *  2. tier fallback:  local=0.12  frontier=0.45  unknown=0.25
 *
 * Using a relative threshold (highEntropyThreshold × 0.6) means the gate
 * automatically scales as more run data arrives, without manual tuning per model.
 */
function calibratedMinEntropy(
  calibration: { highEntropyThreshold: number; calibrated: boolean; sampleCount: number },
  modelTier: string | undefined,
): number {
  if (calibration.calibrated && calibration.sampleCount >= 20) {
    return calibration.highEntropyThreshold * 0.6;
  }
  switch (modelTier) {
    case "local":    return 0.12;
    case "frontier": return 0.45;
    default:         return 0.25;
  }
}

/**
 * Score entropy and evaluate reactive controller for one kernel iteration.
 *
 * Returns updated state (with controllerDecisions / controllerDecisionLog) and
 * the new prevStepCount (= state.steps.length after scoring).
 */
export function runReactiveObserver(
  state: KernelState,
  services: StrategyServices,
  eventBus: Option.Option<EventBusInstance>,
  prevStepCount: number,
  currentOptions: KernelRunOptions,
  signals: ReactiveObserverSignals = {},
): Effect.Effect<{ state: KernelState; prevStepCount: number }, never> {
  const { harnessPipeline, redirectsIssued, switchingAvailable } = signals;
  return Effect.gen(function* () {
    let s = state;

    // ── Entropy scoring (post-kernel, pre-loop-detection) ──────────────
    if (Option.isSome(services.entropySensor)) {
      const newThoughtSteps = s.steps.filter(
        (step, idx) => step.type === "thought" && idx >= prevStepCount,
      );
      if (newThoughtSteps.length > 0) {
        const latestThought = newThoughtSteps[newThoughtSteps.length - 1]!;
        const priorThoughts = s.steps
          .slice(0, prevStepCount)
          .filter((step) => step.type === "thought");
        const priorThought = priorThoughts.length > 0
          ? priorThoughts[priorThoughts.length - 1]!.content
          : undefined;

        // think.ts pre-increments state.iteration on every exit path (both terminal
        // and continuing), so by the time runReactiveObserver is called, s.iteration
        // is already "next iteration index". Subtract 1 to get the iteration that
        // just produced the thought being scored. This keeps the entropy-scored trace
        // event's `iter` field at the correct 0-based completed-iteration index,
        // so traceStats().iterations = maxIter + 1 = 1 for a single-iteration run.
        const completedIteration = Math.max(0, s.iteration - 1);

        yield* services.entropySensor.value
          .score({
            thought: latestThought.content ?? "",
            taskDescription: s.meta.entropy?.taskDescription ?? "",
            strategy: s.strategy,
            iteration: completedIteration,
            maxIterations: (s.meta.maxIterations as number) ?? 10,
            modelId: s.meta.entropy?.modelId ?? "unknown",
            providerName: s.meta.entropy?.providerName,
            temperature: s.meta.entropy?.temperature ?? 0,
            priorThought,
            logprobs: s.meta.entropy?.lastLogprobs,
            kernelState: asKernelStateLike(s),
            taskCategory: s.meta.entropy?.taskCategory,
          })
          .pipe(
            Effect.tap((score) => {
              const entropyScore = score as EntropyScoreLike;
              const entropyMeta = s.meta.entropy ?? {};
              const history = [...(entropyMeta.entropyHistory ?? []), entropyScore];
              s = transitionState(s, { meta: { ...s.meta, entropy: { ...entropyMeta, entropyHistory: history } } });

              const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
                Effect.serviceOption(ObservableLogger).pipe(
                  Effect.flatMap((opt) =>
                    opt._tag === "Some"
                      ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:136", tag: errorTag(err) })))
                      : Effect.void
                  )
                );

              const logEntropy = emitLog({
                _tag: "metric",
                name: "entropy",
                value: entropyScore.composite,
                unit: "composite",
                timestamp: new Date(),
              });

              if (Option.isSome(eventBus)) {
                // score may have richer fields from reactive-intelligence beyond EntropyScoreLike
                const richScore = score as Record<string, unknown>;
                return Effect.all([
                  eventBus.value.publish({
                    _tag: "EntropyScored",
                    taskId: s.taskId,
                    iteration: typeof richScore["iteration"] === "number" ? richScore["iteration"] : completedIteration,
                    composite: entropyScore.composite,
                    sources: richScore["sources"],
                    trajectory: richScore["trajectory"],
                    confidence: richScore["confidence"],
                    modelTier: richScore["modelTier"],
                    iterationWeight: richScore["iterationWeight"],
                    modelId: s.meta.entropy?.modelId ?? "unknown",
                  }),
                  logEntropy,
                ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
              }
              return logEntropy;
            }),
            Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:170", tag: errorTag(err) })),
          );
      }
    }
    const newPrevStepCount = s.steps.length;

    // ── Reactive Controller evaluation ──────────────────────────────────
    if (Option.isSome(services.reactiveController)) {
      // `entropyHistory` is declared `readonly EntropyScoreLike[]` on the kernel
      // state (kernel-state.ts), so no cast is needed — the richer runtime entries
      // are read through the EntropyScoreLike view.
      const entropyHistory = s.meta.entropy?.entropyHistory ?? [];
      if (entropyHistory.length > 0) {
        const latestScore = entropyHistory[entropyHistory.length - 1];

        // ── Load calibration from EntropySensorService (not hardcoded) ──
        const modelId = s.meta.entropy?.modelId ?? currentOptions.modelId ?? "unknown";
        let calibration: {
          readonly highEntropyThreshold: number;
          readonly convergenceThreshold: number;
          readonly calibrated: boolean;
          readonly sampleCount: number;
        } = { highEntropyThreshold: 0.8, convergenceThreshold: 0.4, calibrated: false, sampleCount: 0 };

        if (Option.isSome(services.entropySensor)) {
          const cal = yield* services.entropySensor.value.getCalibration(modelId).pipe(
            Effect.catchAll(() => Effect.succeed(calibration)),
          );
          calibration = {
            highEntropyThreshold: cal.highEntropyThreshold,
            convergenceThreshold: cal.convergenceThreshold,
            calibrated: cal.calibrated,
            sampleCount: cal.sampleCount,
          };

          // ── Emit CalibrationDrift event when drift is detected ──
          const calWithDrift = cal as typeof cal & { driftDetected?: boolean; expectedMean?: number; observedMean?: number; deviationSigma?: number };
          if (calWithDrift.driftDetected && Option.isSome(eventBus)) {
            yield* eventBus.value.publish({
              _tag: "CalibrationDrift",
              taskId: s.taskId,
              modelId,
              expectedMean: calWithDrift.expectedMean ?? 0,
              observedMean: calWithDrift.observedMean ?? 0,
              deviationSigma: calWithDrift.deviationSigma ?? 0,
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:215", tag: errorTag(err) })));
          }
        }

        // Extract decision types already fired this run for evaluators that
        // condition on exhaustion of prior decisions.
        const priorDecisionsThisRun = s.controllerDecisionLog.map((entry) => {
          const colonIdx = entry.indexOf(":");
          return colonIdx > 0 ? entry.slice(0, colonIdx).trim() : entry;
        });

        // Consecutive same-tool failure streak from message history; tool-gate
        // refusals are skipped (they never ran — reflect/tool-failure-streak.ts).
        const {
          count: consecutiveToolFailures,
          toolName: failingToolName,
          failedArgsKeys: failingArgsKeys,
        } = toolFailureStreak(s.messages);
        // The batch the model just emitted, not yet run by act (this observer
        // runs after think too), always passed: empty means nothing is pending
        // (after act, or a turn with no tool calls). RI's tool-failure-redirect
        // reads it: a batch that no longer calls the failing tool is not an
        // ignored redirect, and after the nudge only an identical failing call
        // (same name + canonical args) is.
        const pendingToolCalls = (s.meta.pendingNativeToolCalls ?? []).map((c) => ({
          name: c.name,
          argsKey: toolCallArgsKey(c.arguments),
        }));

        const outputs = yield* services.reactiveController.value.evaluate({
          entropyHistory,
          iteration: s.iteration,
          maxIterations: currentOptions.maxIterations,
          strategy: s.strategy,
          calibration,
          config: s.meta.entropy?.controllerConfig ?? {
            earlyStop: true,
            strategySwitch: true,
          },
          behavioralLoopScore: latestScore?.sources?.behavioral ?? 0,
          priorDecisionsThisRun: priorDecisionsThisRun.length > 0 ? priorDecisionsThisRun : undefined,
          consecutiveToolFailures: consecutiveToolFailures > 0 ? consecutiveToolFailures : undefined,
          failingToolName,
          failingArgsKeys,
          pendingToolCalls,
          // FM-A3 backstop — empty-output invariant for RI early-stop.
          hasUserOutput: typeof s.output === "string" && s.output.trim().length > 0,
          // RC-3 — single loop-stuck trigger authority. The kernel's redirect
          // streak is the trigger; entropy only escalates a stall the kernel
          // already acted on. Absent → RI's strategy-switch fails closed.
          ...(redirectsIssued === undefined ? {} : { kernelLoopSignal: { redirectsIssued } }),
          ...(switchingAvailable === undefined ? {} : { switchingAvailable }),
          // E2 (audit 02-#5 / H6 generalized) — surface the RunAssessment phase
          // ONLY under the long-horizon profile so RI early-stop stands down in
          // the synthesize endgame. Absent off the profile → byte-identical.
          ...(s.meta.horizonProfile === "long" && s.meta.assessment
            ? { phase: s.meta.assessment.phase }
            : {}),
          // S2a (spike pack 2026-11-06) — the run's one progress measure, on
          // every path. This observer runs after the pass's post-act assess
          // (turn-operations "think" op), so the delta counts evidence landed
          // in the current iteration, including this pass's act.
          // RI's overflow early-stop stands down while a run is still producing.
          ...(s.meta.assessment
            ? { progressedThisPass: s.meta.assessment.evidenceDelta > 0 }
            : {}),
        });

        for (const decision of outputs) {
          // Publish ReactiveDecision event (interventions and notices alike)
          if (Option.isSome(eventBus)) {
            yield* eventBus.value.publish({
              _tag: "ReactiveDecision",
              taskId: s.taskId,
              iteration: s.iteration,
              decision: (decision as Record<string, unknown>).decision,
              reason: (decision as Record<string, unknown>).reason,
              entropyBefore: latestScore?.composite ?? 0,
              // Forward the controller-supplied confidence (e.g. switch-strategy's
              // loop-score headroom) — without this, trace/normalize.ts's
              // ReactiveDecision mapper never sees it and falls back to the
              // entropyBefore/After delta formula (always 0 for switch-strategy).
              ...((decision as Record<string, unknown>).confidence !== undefined
                ? { confidence: (decision as Record<string, unknown>).confidence }
                : {}),
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:329", tag: errorTag(err) })));
          }
        }

        // Notices (RI `ControllerNotice`) are trace-only: never dispatched,
        // stored or logged as fires. `early-stop-withheld` — the near-cap
        // early-stop stood down because the run produced evidence (S2a). It is
        // recorded as a guard event so trace activity (`guard:ri-early-stop:block`,
        // read by h3 verdict) shows the stand-down acted; without it the
        // early-stop/redirect verdict (2026-11-06) read S2a as inert.
        const decisions = outputs.filter((o) => o.decision !== EARLY_STOP_WITHHELD);
        for (const notice of outputs) {
          if (notice.decision !== EARLY_STOP_WITHHELD || Option.isNone(eventBus)) continue;
          yield* eventBus.value.publish({
            _tag: "GuardFiredEmitted",
            taskId: s.taskId,
            iteration: s.iteration,
            guard: "ri-early-stop",
            outcome: "block",
            reason: notice.reason,
            metadata: { branch: "near-cap", standDown: "progressed-this-pass" },
            timestamp: Date.now(),
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:early-stop-withheld", tag: errorTag(err) })));
        }

        // Store all controller decisions on state so the termination oracle can consume them.
        // The oracle's reactiveControllerEarlyStopEvaluator reads state.meta.controllerDecisions
        // and signals a high-confidence exit when an early-stop decision is present.
        if (decisions.length > 0) {
          s = transitionState(s, {
            meta: { ...s.meta, controllerDecisions: decisions },
          });

          // ── Intervention dispatcher ─────────────────────────────────────
          // Dispatch decisions through the handler registry when the dispatcher
          // service is available. Patches are folded back into KernelState via
          // transitionState using only fields that exist on KernelMeta / KernelState.
          if (Option.isSome(services.dispatcher)) {
            const richLatest = latestScore as {
              composite?: number; token?: number; structural?: number;
              semantic?: number; behavioral?: number;
              sources?: { contextPressure?: number };
            } | undefined;
            const modelTier = latestScore?.modelTier;
            // W3 FIX-23: read accumulated RI budget from KernelState.meta.riBudget so
            // suppression gates at dispatcher.ts:69-76 can actually trip. Prior to W3
            // this was hardcoded to {0,0} every iteration → gates unreachable.
            const priorBudget = s.meta.riBudget ?? {
              interventionsFiredThisRun: 0,
              tokensSpentOnInterventions: 0,
            };
            const dispatchContext = {
              iteration: s.iteration,
              entropyScore: {
                composite: richLatest?.composite ?? 0,
                token: richLatest?.token ?? 0,
                structural: richLatest?.structural ?? 0,
                semantic: richLatest?.semantic ?? 0,
                behavioral: richLatest?.behavioral ?? 0,
                contextPressure: richLatest?.sources?.contextPressure ?? 0,
              },
              recentDecisions: decisions as readonly { readonly decision: string; readonly reason: string }[],
              budget: priorBudget,
              adaptiveMinEntropy: calibratedMinEntropy(calibration, modelTier),
              // HS-112 — bridge applied RI decisions into Compose tags.
              harnessPipeline,
            };
            const dispatchResult = yield* services.dispatcher.value
              .dispatch(
                decisions as readonly { readonly decision: string; readonly reason: string }[],
                s as unknown as Readonly<Record<string, unknown>>,
                dispatchContext,
              )
              .pipe(Effect.catchAll(() => Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } })));

            // controllerDecisionLog records only decisions the dispatcher APPLIED,
            // appended after dispatch. Handlers count prior fires from it
            // (tool-failure-redirect escalates on a repeat), and evaluators read it
            // as `priorDecisionsThisRun`. Logging before dispatch counted suppressed
            // decisions as fires: a redirect suppressed by the entropy floor or the
            // fire budget, then dispatched once, escalated straight to an early
            // stop "after an ignored nudge" no model ever saw (RI census 2026-11-06,
            // residual B).
            const appliedTypes = new Set(dispatchResult.appliedPatches.map((p) => p.decisionType));
            const applied = decisions.filter((d) => appliedTypes.has(d.decision));
            if (applied.length > 0) {
              s = transitionState(s, {
                controllerDecisionLog: [
                  ...s.controllerDecisionLog,
                  ...applied.map((d) => (d.reason ? `${d.decision}: ${d.reason}` : d.decision)),
                ],
              });
            }

            // W3 FIX-23: accumulate budget from this iteration's dispatch into
            // KernelState.meta.riBudget so the next iteration's suppression gates
            // see real counts. interventionsFiredThisRun increments by patches
            // applied; tokensSpentOnInterventions accumulates the totalCost reported
            // by the dispatcher.
            if (dispatchResult.appliedPatches.length > 0 || dispatchResult.totalCost.tokens > 0) {
              s = transitionState(s, {
                meta: {
                  ...s.meta,
                  riBudget: {
                    interventionsFiredThisRun:
                      priorBudget.interventionsFiredThisRun + dispatchResult.appliedPatches.length,
                    tokensSpentOnInterventions:
                      priorBudget.tokensSpentOnInterventions + dispatchResult.totalCost.tokens,
                  },
                },
              });
            }

            // Emit InterventionDispatched events for applied patches.
            // HS-107: decisionType carries the ControllerDecision that fired
            // (e.g. "tool-failure-redirect"); patchKind carries the KernelStatePatch
            // produced (e.g. "append-system-nudge"). Prior code passed
            // patch.kind for both, conflating 8 names for 5 decisions in
            // trace analytics.
            for (const { decisionType, patch } of dispatchResult.appliedPatches) {
              if (Option.isSome(eventBus)) {
                yield* eventBus.value.publish({
                  _tag: "InterventionDispatched",
                  taskId: s.taskId,
                  iteration: s.iteration,
                  decisionType,
                  patchKind: patch.kind,
                  cost: {
                    tokensEstimated: dispatchResult.totalCost.tokens,
                    latencyMsEstimated: dispatchResult.totalCost.latencyMs,
                  },
                  telemetry: {},
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:435", tag: errorTag(err) })));
              }

              switch (patch.kind) {
                case "early-stop":
                  // Always use "dispatcher-early-stop" as the sentinel so kernel-runner
                  // can reliably break on this exact value. The evaluator reason is
                  // preserved in the InterventionDispatched trace event.
                  s = transitionState(s, {
                    meta: {
                      ...s.meta,
                      terminatedBy: "dispatcher-early-stop",
                      dispatcherEarlyStop: { reason: typeof patch.reason === "string" ? patch.reason : "", iteration: s.iteration },
                    },
                  });
                  break
                case "append-system-nudge": {
                  const np = patch as { kind: "append-system-nudge"; text: string };
                  // Merge into errorRecovery so think.ts renders it in the next Guidance: block
                  s = transitionState(s, { pendingGuidance: appendGuidanceText(s.pendingGuidance, "errorRecovery", np.text) });
                  break
                }
                case "request-strategy-switch": {
                  const rsp = patch as { kind: "request-strategy-switch"; to: string; reason: string };
                  s = transitionState(s, {
                    meta: {
                      ...s.meta,
                      terminatedBy: "dispatcher-strategy-switch",
                      dispatchedStrategySwitch: { to: rsp.to, reason: rsp.reason },
                    },
                  });
                  break
                }
                default:
                  break
              }
            }

            // Emit InterventionSuppressed events for skipped decisions
            for (const skipped of dispatchResult.skipped) {
              if (Option.isSome(eventBus)) {
                yield* eventBus.value.publish({
                  _tag: "InterventionSuppressed",
                  taskId: s.taskId,
                  iteration: s.iteration,
                  decisionType: skipped.decisionType,
                  reason: skipped.reason as
                    | "below-entropy-threshold"
                    | "below-iteration-threshold"
                    | "over-budget"
                    | "max-fires-exceeded"
                    | "mode-advisory"
                    | "mode-off"
                    | "no-handler",
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:563", tag: errorTag(err) })));
              }
            }
          }
        }
      }
    }

    return { state: s, prevStepCount: newPrevStepCount };
  });
}
