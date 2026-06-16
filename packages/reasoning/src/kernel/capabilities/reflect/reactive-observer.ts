/**
 * Reactive Observer — entropy scoring and reactive controller evaluation.
 *
 * Runs after each kernel step (post-kernel, pre-loop-detection) to:
 *   1. Score the latest thought through the EntropySensor and append to entropyHistory
 *   2. Evaluate the reactive controller and accumulate controllerDecisions/controllerDecisionLog
 *
 * Extracted from kernel-runner.ts to keep the main loop focused on iteration logic.
 */
import { Effect } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { transitionState } from "../../../kernel/state/kernel-state.js";
import type { KernelState, KernelRunOptions, MaybeService, EventBusInstance } from "../../../kernel/state/kernel-state.js";
import type { StrategyServices } from "../../../kernel/utils/service-utils.js";
import type { EntropyScoreLike } from "../../../kernel/loop/output-assembly.js";
import type { ModelTier } from "../../../context/context-profile.js";
import { evaluateVerbosity } from "./verbosity-detector.js";

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
  eventBus: MaybeService<EventBusInstance>,
  prevStepCount: number,
  currentOptions: KernelRunOptions,
  tier: ModelTier,
  harnessPipeline?: import("@reactive-agents/core").HarnessPipeline,
): Effect.Effect<{ state: KernelState; prevStepCount: number }, never> {
  return Effect.gen(function* () {
    let s = state;

    // ── Entropy scoring (post-kernel, pre-loop-detection) ──────────────
    if (services.entropySensor._tag === "Some") {
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
            temperature: s.meta.entropy?.temperature ?? 0,
            priorThought,
            logprobs: s.meta.entropy?.lastLogprobs,
            kernelState: s,
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
                      ? opt.value.emit(event).pipe(Effect.catchAll(() => Effect.void))
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

              if (eventBus._tag === "Some") {
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
                  }),
                  logEntropy,
                ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
              }
              return logEntropy;
            }),
            Effect.catchAll(() => Effect.void),
          );
      }
    }
    const newPrevStepCount = s.steps.length;

    // ── Reactive Controller evaluation ──────────────────────────────────
    if (services.reactiveController._tag === "Some") {
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

        if (services.entropySensor._tag === "Some") {
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
          if (calWithDrift.driftDetected && eventBus._tag === "Some") {
            yield* eventBus.value.publish({
              _tag: "CalibrationDrift",
              taskId: s.taskId,
              modelId,
              expectedMean: calWithDrift.expectedMean ?? 0,
              observedMean: calWithDrift.observedMean ?? 0,
              deviationSigma: calWithDrift.deviationSigma ?? 0,
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        }

        // Collect available tool names for evaluators that need them (e.g. tool-inject)
        const availableToolNames: string[] = [];
        if (services.toolService._tag === "Some") {
          const toolList = yield* services.toolService.value.listTools().pipe(
            Effect.catchAll(() => Effect.succeed([] as readonly { readonly name: string }[])),
          );
          for (const t of toolList) availableToolNames.push(t.name);
        }

        // Extract decision types already fired this run for evaluators that
        // condition on exhaustion of prior decisions.
        const priorDecisionsThisRun = s.controllerDecisionLog.map((entry) => {
          const colonIdx = entry.indexOf(":");
          return colonIdx > 0 ? entry.slice(0, colonIdx).trim() : entry;
        });

        // Compute consecutive same-tool failure streak from message history.
        // Scans backwards through tool_result messages; breaks on first success or tool change.
        let consecutiveToolFailures = 0;
        let failingToolName: string | undefined;
        const toolResultMsgs = s.messages.filter(
          (m): m is Extract<typeof m, { role: "tool_result" }> => m.role === "tool_result",
        );
        for (let i = toolResultMsgs.length - 1; i >= 0; i--) {
          const m = toolResultMsgs[i]!;
          if (!m.isError) break;
          if (!failingToolName) failingToolName = m.toolName;
          if (m.toolName !== failingToolName) break;
          consecutiveToolFailures++;
        }

        // Tool-progress signal for stall-detect (rw-9 fix): consecutive THOUGHT
        // steps at the ledger tail with no intervening tool action/observation.
        // A confidently low-entropy agent still calling distinct tools (find→
        // file-read) has a LOW count → not a stall; a circling agent has a high
        // count. Action OR observation steps reset the streak (mirrors the
        // loop-detector's "only ACTION steps reset the streak" philosophy).
        let consecutiveThoughtsWithoutAction = 0;
        for (let i = s.steps.length - 1; i >= 0; i--) {
          const st = s.steps[i]!;
          if (st.type === "thought") {
            consecutiveThoughtsWithoutAction++;
          } else if (st.type === "action" || st.type === "observation") {
            break;
          }
        }

        const decisions = yield* services.reactiveController.value.evaluate({
          entropyHistory,
          iteration: s.iteration,
          maxIterations: currentOptions.maxIterations,
          strategy: s.strategy,
          calibration,
          config: s.meta.entropy?.controllerConfig ?? {
            earlyStop: true,
            contextCompression: true,
            strategySwitch: true,
          },
          contextPressure: latestScore?.sources?.contextPressure ?? 0,
          behavioralLoopScore: latestScore?.sources?.behavioral ?? 0,
          currentTemperature: currentOptions.temperature ?? s.meta.entropy?.temperature,
          availableToolNames: availableToolNames.length > 0 ? availableToolNames : undefined,
          priorDecisionsThisRun: priorDecisionsThisRun.length > 0 ? priorDecisionsThisRun : undefined,
          consecutiveToolFailures: consecutiveToolFailures > 0 ? consecutiveToolFailures : undefined,
          failingToolName,
          consecutiveThoughtsWithoutAction,
          // FM-A3 backstop — empty-output invariant for RI early-stop.
          hasUserOutput: typeof s.output === "string" && s.output.trim().length > 0,
          // DEFECT 1 fix — thread the real model tier so stall-detect uses the
          // correct tier-scaled stall window (mid=3/large=4/frontier=5) instead
          // of the hardcoded local=2 that caused premature give-up at iter 2.
          tier,
        });

        for (const decision of decisions) {
          // Publish ReactiveDecision event
          if (eventBus._tag === "Some") {
            yield* eventBus.value.publish({
              _tag: "ReactiveDecision",
              taskId: s.taskId,
              iteration: s.iteration,
              decision: (decision as Record<string, unknown>).decision,
              reason: (decision as Record<string, unknown>).reason,
              entropyBefore: latestScore?.composite ?? 0,
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        }

        // Store all controller decisions on state so the termination oracle can consume them.
        // The oracle's reactiveControllerEarlyStopEvaluator reads state.meta.controllerDecisions
        // and signals a high-confidence exit when an early-stop decision is present.
        if (decisions.length > 0) {
          s = transitionState(s, {
            meta: { ...s.meta, controllerDecisions: decisions },
          });

          // Accumulate into controllerDecisionLog for pulse tool access
          const formatted = decisions.map((d: Record<string, unknown>) => {
            const decision = String(d.decision ?? "");
            const context =
              typeof d.reason === "string" ? d.reason
              : "sections" in d && Array.isArray(d.sections) ? `sections=[${(d.sections as string[]).join(",")}]`
              : typeof d.skillName === "string" ? d.skillName
              : "";
            return context ? `${decision}: ${context}` : decision;
          });
          s = transitionState(s, {
            controllerDecisionLog: [...s.controllerDecisionLog, ...formatted],
          });

          // ── Intervention dispatcher ─────────────────────────────────────
          // Dispatch decisions through the handler registry when the dispatcher
          // service is available. Patches are folded back into KernelState via
          // transitionState using only fields that exist on KernelMeta / KernelState.
          if (services.dispatcher._tag === "Some") {
            const richLatest = latestScore as {
              composite?: number; token?: number; structural?: number;
              semantic?: number; behavioral?: number;
              sources?: { contextPressure?: number };
            } | undefined;
            const modelTier = (latestScore as Record<string, unknown>)?.modelTier as string | undefined;
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
            // (e.g. "tool-inject"); patchKind carries the KernelStatePatch
            // produced (e.g. "inject-tool-guidance"). Prior code passed
            // patch.kind for both, conflating 8 names for 5 decisions in
            // trace analytics.
            for (const { decisionType, patch } of dispatchResult.appliedPatches) {
              if (eventBus._tag === "Some") {
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
                }).pipe(Effect.catchAll(() => Effect.void));
              }

              switch (patch.kind) {
                case "early-stop":
                  // Always use "dispatcher-early-stop" as the sentinel so kernel-runner
                  // can reliably break on this exact value. The evaluator reason is
                  // preserved in the InterventionDispatched trace event.
                  s = transitionState(s, {
                    meta: { ...s.meta, terminatedBy: "dispatcher-early-stop" },
                  });
                  break
                case "compress-messages": {
                  // Issue #119 / North Star v5.0 §4.3 — curator is the sole
                  // authority that authors Prompt.messages. The patch handler
                  // is demoted from "rogue mutator" to "advisory recommender":
                  // it records a CompressionRecommendation on
                  // state.meta.pendingCompressionRecommendation and emits an
                  // advisory log event. The curator
                  // (applyMessageWindowWithCompact via
                  // kernel/capabilities/attend/context-utils.ts) consumes the
                  // recommendation on the next iteration to clamp the
                  // effective token budget. state.messages is left untouched
                  // here — single-author discipline.
                  const p = patch as { kind: "compress-messages"; targetTokens: number };
                  const reason =
                    typeof (patch as Record<string, unknown>).reason === "string"
                      ? ((patch as Record<string, unknown>).reason as string)
                      : "context-pressure";
                  s = transitionState(s, {
                    meta: {
                      ...s.meta,
                      pendingCompressionRecommendation: {
                        targetTokens: p.targetTokens,
                        reason,
                        recommendedAtIteration: s.iteration,
                      },
                    },
                  });
                  // Typed advisory trace event (schema landed: CompressionRecommendation
                  // variant in @reactive-agents/core EventBus AgentEvent union).
                  // Source discriminant: "dispatcher" distinguishes this from the
                  // verbosity-detector emission site below.
                  if (eventBus._tag === "Some") {
                    yield* eventBus.value.publish({
                      _tag: "CompressionRecommendation",
                      taskId: s.taskId,
                      iteration: s.iteration,
                      source: "dispatcher",
                      targetTokens: p.targetTokens,
                      reason,
                    }).pipe(Effect.catchAll(() => Effect.void));
                  }
                  break
                }
                case "append-system-nudge": {
                  const np = patch as { kind: "append-system-nudge"; text: string };
                  // Merge into errorRecovery so think.ts renders it in the next Guidance: block
                  const existingRecovery = s.pendingGuidance?.errorRecovery;
                  const combined = existingRecovery
                    ? `${existingRecovery}\n${np.text}`
                    : np.text;
                  s = transitionState(s, {
                    pendingGuidance: { ...s.pendingGuidance, errorRecovery: combined },
                  });
                  break
                }
                case "inject-tool-guidance": {
                  const tp = patch as { kind: "inject-tool-guidance"; text: string };
                  const existingRecovery = s.pendingGuidance?.errorRecovery;
                  const combined = existingRecovery
                    ? `${existingRecovery}\n${tp.text}`
                    : tp.text;
                  s = transitionState(s, {
                    pendingGuidance: { ...s.pendingGuidance, errorRecovery: combined },
                  });
                  break
                }
                case "set-temperature": {
                  const tp = patch as { kind: "set-temperature"; temperature: number };
                  s = transitionState(s, {
                    meta: { ...s.meta, dispatchedTemperature: tp.temperature },
                  });
                  break
                }
                case "inject-skill-content": {
                  const sp = patch as { kind: "inject-skill-content"; skillId: string; content: string };
                  const existingRecovery = s.pendingGuidance?.errorRecovery;
                  const combined = existingRecovery
                    ? `${existingRecovery}\n${sp.content}`
                    : sp.content;
                  s = transitionState(s, {
                    pendingGuidance: { ...s.pendingGuidance, errorRecovery: combined },
                  });
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
              if (eventBus._tag === "Some") {
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
                }).pipe(Effect.catchAll(() => Effect.void));
              }
            }
          }
        }
      }
    }

    // ── HS-128 — Verbosity detector (independent of RI dispatcher) ───────
    // Placed OUTSIDE the reactiveController/dispatcher block so the
    // detector fires even on runs without RI configured. The detector reads
    // the rolling token window snapshotted by think.ts at
    // `state.meta.lastIterationTokens` and publishes a
    // pendingCompressionRecommendation when the running average exceeds
    // 2× the tier-derived baseline (~maxTokens/64).
    //
    // Freshness gate (mirrors curator-side at context-utils.ts:140 and the
    // dispatcher's compress-messages branch above) prevents this detector
    // from overwriting a peer recommendation that already fired this turn
    // or last.
    //
    // HS-128 FOLLOWUP-A — profileMaxTokens is seeded once on state.meta by the
    // runner from the resolved ContextProfile (kernel/loop/runner.ts after the
    // profile-build block). When absent (legacy state / synthetic test state),
    // the helper falls back to the local-tier default (32_768). Curator-side
    // applies its own profile clamp so a too-generous target still gets
    // bounded.
    {
      const verbosityRec = evaluateVerbosity({
        lastIterationTokens: s.meta.lastIterationTokens,
        iteration: s.iteration,
        profileMaxTokens: s.meta.profileMaxTokens,
        existingRecommendation: s.meta.pendingCompressionRecommendation,
      });
      if (verbosityRec) {
        s = transitionState(s, {
          meta: {
            ...s.meta,
            pendingCompressionRecommendation: verbosityRec,
          },
        });
        // Typed advisory trace event with source="verbosity-detector"
        // discriminant. Lets observers distinguish detector-driven vs
        // dispatcher-driven recommendations without colliding their
        // thresholds.
        if (eventBus._tag === "Some") {
          yield* eventBus.value.publish({
            _tag: "CompressionRecommendation",
            taskId: s.taskId,
            iteration: s.iteration,
            source: "verbosity-detector",
            targetTokens: verbosityRec.targetTokens,
            reason: verbosityRec.reason,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      }
    }

    return { state: s, prevStepCount: newPrevStepCount };
  });
}
