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
import { transitionState } from "../kernel-state.js";
import type { KernelState, KernelRunOptions, MaybeService, EventBusInstance } from "../kernel-state.js";
import type { StrategyServices } from "./service-utils.js";

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
            taskDescription: (s.meta.entropy as any)?.taskDescription ?? "",
            strategy: s.strategy,
            iteration: s.iteration,
            maxIterations: (s.meta.maxIterations as number) ?? 10,
            modelId: (s.meta.entropy as any)?.modelId ?? "unknown",
            temperature: (s.meta.entropy as any)?.temperature ?? 0,
            priorThought,
            logprobs: (s.meta.entropy as any)?.lastLogprobs,
            kernelState: s,
            taskCategory: (s.meta.entropy as any)?.taskCategory,
          })
          .pipe(
            Effect.tap((score: any) => {
              const entropyMeta = (s.meta as any).entropy ?? {};
              const history = entropyMeta.entropyHistory ?? [];
              history.push(score);
              (s.meta as any).entropy = { ...entropyMeta, entropyHistory: history };

              if (eventBus._tag === "Some") {
                return eventBus.value.publish({
                  _tag: "EntropyScored",
                  taskId: s.taskId,
                  iteration: score.iteration,
                  composite: score.composite,
                  sources: score.sources,
                  trajectory: score.trajectory,
                  confidence: score.confidence,
                  modelTier: score.modelTier,
                  iterationWeight: score.iterationWeight,
                });
              }
              return Effect.void;
            }),
            Effect.catchAll(() => Effect.void),
          );
      }
    }
    const newPrevStepCount = s.steps.length;

    // ── Reactive Controller evaluation ──────────────────────────────────
    if (services.reactiveController._tag === "Some") {
      const entropyHistory = ((s.meta as any).entropy?.entropyHistory ?? []) as readonly any[];
      if (entropyHistory.length > 0) {
        const latestScore = entropyHistory[entropyHistory.length - 1];

        // ── Load calibration from EntropySensorService (not hardcoded) ──
        const modelId = (s.meta as any).entropy?.modelId ?? currentOptions.modelId ?? "unknown";
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
          if ((cal as any).driftDetected && eventBus._tag === "Some") {
            yield* eventBus.value.publish({
              _tag: "CalibrationDrift",
              taskId: s.taskId,
              modelId,
              expectedMean: (cal as any).expectedMean ?? 0,
              observedMean: (cal as any).observedMean ?? 0,
              deviationSigma: (cal as any).deviationSigma ?? 0,
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        }

        const decisions = yield* services.reactiveController.value.evaluate({
          entropyHistory,
          iteration: s.iteration,
          maxIterations: currentOptions.maxIterations,
          strategy: s.strategy,
          calibration,
          config: (s.meta as any).entropy?.controllerConfig ?? {
            earlyStop: true,
            contextCompression: true,
            strategySwitch: true,
          },
          contextPressure: latestScore?.sources?.contextPressure ?? 0,
          behavioralLoopScore: latestScore?.sources?.behavioral ?? 0,
        });

        for (const decision of decisions) {
          // Publish ReactiveDecision event
          if (eventBus._tag === "Some") {
            yield* eventBus.value.publish({
              _tag: "ReactiveDecision",
              taskId: s.taskId,
              iteration: s.iteration,
              decision: (decision as any).decision,
              reason: (decision as any).reason,
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
        }
      }
    }

    return { state: s, prevStepCount: newPrevStepCount };
  });
}
