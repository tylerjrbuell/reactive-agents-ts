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
import { transitionState } from "../kernel-state.js";
import type { KernelState, KernelRunOptions, MaybeService, EventBusInstance } from "../kernel-state.js";
import type { StrategyServices } from "./service-utils.js";
import type { EntropyScoreLike } from "../output-assembly.js";

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

        yield* services.entropySensor.value
          .score({
            thought: latestThought.content ?? "",
            taskDescription: s.meta.entropy?.taskDescription ?? "",
            strategy: s.strategy,
            iteration: s.iteration,
            maxIterations: (s.meta.maxIterations as number) ?? 10,
            modelId: s.meta.entropy?.modelId ?? "unknown",
            temperature: s.meta.entropy?.temperature ?? 0,
            priorThought,
            logprobs: s.meta.entropy?.lastLogprobs,
            kernelState: s as any, // cross-package boundary: KernelStateLike expects index-sig meta
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
                    iteration: typeof richScore["iteration"] === "number" ? richScore["iteration"] : s.iteration,
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
      // entropyHistory holds EntropyScoreLike[] locally, but the full runtime type from
      // reactive-intelligence has additional fields (sources, contextPressure, etc.).
      const entropyHistory = (s.meta.entropy?.entropyHistory ?? []) as readonly any[];
      if (entropyHistory.length > 0) {
        const latestScore = entropyHistory[entropyHistory.length - 1] as any;

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

        // Extract decision types already fired this run for human-escalate evaluator
        const priorDecisionsThisRun = s.controllerDecisionLog.map((entry) => {
          const colonIdx = entry.indexOf(":");
          return colonIdx > 0 ? entry.slice(0, colonIdx).trim() : entry;
        });

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
              budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
            };
            const dispatchResult = yield* services.dispatcher.value
              .dispatch(
                decisions as readonly { readonly decision: string; readonly reason: string }[],
                s as unknown as Readonly<Record<string, unknown>>,
                dispatchContext,
              )
              .pipe(Effect.catchAll(() => Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } })));

            // Emit InterventionDispatched events for applied patches
            for (const patch of dispatchResult.appliedPatches) {
              if (eventBus._tag === "Some") {
                yield* eventBus.value.publish({
                  _tag: "InterventionDispatched",
                  taskId: s.taskId,
                  iteration: s.iteration,
                  decisionType: patch.kind,
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
                  // handled: early-stop terminates the kernel loop
                  // Always use "dispatcher-early-stop" as the sentinel so kernel-runner
                  // can reliably break on this exact value. The evaluator reason is
                  // preserved in the InterventionDispatched trace event.
                  s = transitionState(s, {
                    meta: { ...s.meta, terminatedBy: "dispatcher-early-stop" },
                  });
                  break
                default:
                  // Other patch kinds (temp-adjust, compress-messages, etc.) are applied
                  // by the caller via applyPatches() once kernel state becomes accessible here.
                  // This is a known gap: Tasks 3.x handlers will need this path.
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

    return { state: s, prevStepCount: newPrevStepCount };
  });
}
