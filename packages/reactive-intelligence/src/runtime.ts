import { Layer } from "effect";
import type { ReactiveIntelligenceConfig } from "./types.js";
import { defaultReactiveIntelligenceConfig } from "./types.js";
import { EntropySensorServiceLive } from "./sensor/entropy-sensor-service.js";
import { ReactiveControllerServiceLive } from "./controller/controller-service.js";
import { InterventionDispatcherServiceLive } from "./controller/dispatcher-service.js";
import { CalibrationStore } from "./calibration/calibration-store.js";
import { BanditStore } from "./learning/bandit-store.js";
import { LearningEngineServiceLive } from "./learning/learning-engine.js";
import type { SkillStore } from "./learning/learning-engine.js";
import { StrategySelectorServiceLive, DEFAULT_BANDIT_ARM_IDS } from "./learning/strategy-selector.js";
import { makeSkillResolverService } from "./skills/skill-resolver.js";
import type { SkillResolverConfig } from "./skills/skill-resolver.js";
import { makeSkillDistillerService } from "./skills/skill-distiller.js";
import type { SkillDistillerDeps } from "./skills/skill-distiller.js";
import { subscribeCalibrationUpdates } from "./sensor/calibration-update-subscriber.js";

export type SkillLayerConfig = {
  readonly resolver?: SkillResolverConfig;
  readonly distiller?: SkillDistillerDeps;
  readonly distillerConfig?: { refinementThreshold?: number };
};

/**
 * Single widening boundary for progressive RI layer composition (HS-34;
 * mirrors `finalizeComposition` / HS-03 in `@reactive-agents/runtime`).
 *
 * Effect `Layer` is invariant in its requirements channel, so a binding that
 * is conditionally re-merged cannot keep one static type — the merges diverge.
 * `widen` is the ONE place the widening assertion lives, replacing the four
 * scattered `as any` casts this function previously carried.
 */
type ComposableLayer = Layer.Layer<unknown, unknown, never>;
const widen = <A, E, R>(merged: Layer.Layer<A, E, R>): ComposableLayer =>
  merged as ComposableLayer;

export const createReactiveIntelligenceLayer = (
  config?: Partial<ReactiveIntelligenceConfig>,
  skillStore?: SkillStore,
  skillConfig?: SkillLayerConfig,
) => {
  const merged = { ...defaultReactiveIntelligenceConfig, ...config };

  // Shared calibration store — used by both sensor and learning engine
  const calStore = new CalibrationStore(merged.calibrationDbPath);
  const banditStore = new BanditStore();

  const entropyLayer = EntropySensorServiceLive(merged, calStore);
  const learningLayer = LearningEngineServiceLive(calStore, banditStore, skillStore);

  // Start with entropy + learning
  let combined: ComposableLayer = widen(Layer.merge(entropyLayer, learningLayer));

  // Calibration-drift feedback loop (collected EntropyScored → recalibration →
  // drift detection → controller response). `subscribeCalibrationUpdates`
  // requires `EntropySensorService` and `EventBus`. `Layer.merge` does NOT
  // cross-wire sibling requirements (each merged layer only sees its OWN
  // external input) — so `entropyLayer` is `Layer.provide`d directly into the
  // subscriber layer to satisfy `EntropySensorService` internally, leaving
  // only `EventBus` as this layer's externally-visible requirement, which
  // callers must provide (the runtime facade does this by piping the shared
  // `eventBusLayer` into this layer — see `packages/runtime/src/runtime.ts`).
  // `Layer.scopedDiscard` (not `effectDiscard`) so the `EventBus.on(...)`
  // subscriptions are unsubscribed via the finalizers the subscriber
  // registers when this layer's scope closes.
  //
  // NOTE: `subscribeEntropyScoring` (entropy-event-subscriber.ts) is
  // deliberately NOT wired here. Its in-memory `(taskId, iteration)` dedup
  // set only guards against re-scoring within itself — it has no visibility
  // into the `EntropyScored` events kernel-runner strategies (direct,
  // reactive, reflexion, tree-of-thought, plan-execute) already publish
  // inline via `reactive-observer.ts`'s `runReactiveObserver` whenever
  // `EntropySensorService` is present. Since it subscribes to the generic
  // `ReasoningStepCompleted` event that ALL strategies emit (including
  // kernel-runner ones, via `kernel-hooks.ts`'s `onThought`), wiring it
  // unconditionally would double-score and double-publish `EntropyScored`
  // for every kernel-runner-strategy step, corrupting calibration with
  // duplicate samples. It remains genuinely useful for the strategies that
  // have NO entropy coverage today (blueprint, code-action, adaptive), but
  // wiring it safely needs the dedup to consult already-published
  // `EntropyScored` events (or kernel-runner strategies to skip publishing
  // `ReasoningStepCompleted.thought` when already scored inline) — out of
  // scope for this fix.
  const calibrationSubscriberLayer = Layer.scopedDiscard(subscribeCalibrationUpdates()).pipe(
    Layer.provide(entropyLayer),
  );
  combined = widen(Layer.merge(combined, calibrationSubscriberLayer));

  // Compose controller layer when any controller feature is enabled
  const ctrl = merged.controller;
  const controllerEnabled = ctrl?.earlyStop || ctrl?.contextCompression || ctrl?.strategySwitch;
  if (controllerEnabled) {
    const controllerLayer = ReactiveControllerServiceLive({
      earlyStop: ctrl?.earlyStop ?? false,
      contextCompression: ctrl?.contextCompression ?? false,
      strategySwitch: ctrl?.strategySwitch ?? false,
    });
    const dispatcherLayer = InterventionDispatcherServiceLive();
    combined = widen(Layer.merge(combined, controllerLayer));
    combined = widen(Layer.merge(combined, dispatcherLayer));
  }

  // Skill Resolver (optional)
  if (skillConfig?.resolver) {
    const resolverLayer = makeSkillResolverService(skillConfig.resolver);
    combined = widen(Layer.merge(combined, resolverLayer));
  }

  // Skill Distiller (optional)
  if (skillConfig?.distiller) {
    const distillerLayer = makeSkillDistillerService(
      skillConfig.distiller,
      skillConfig.distillerConfig ? { refinementThreshold: skillConfig.distillerConfig.refinementThreshold ?? 5 } : undefined,
    );
    combined = widen(Layer.merge(combined, distillerLayer));
  }

  // Bandit-driven StrategySelector (OPT-IN, default OFF — see
  // `ReactiveIntelligenceConfig.learning.banditStrategySelection` in
  // types.ts). Only merged when explicitly enabled; shares the SAME
  // `banditStore` instance `learningLayer` writes to via `updateArm`, so
  // reads reflect what the write side actually recorded. Every existing
  // caller who has not set this flag gets zero behavior change — runtime's
  // `strategy-select.ts` Phase resolves `Effect.serviceOption` and falls
  // back to `config.defaultStrategy` exactly as before when the service is
  // absent from context.
  const banditStrategySelection = merged.learning?.banditStrategySelection;
  if (banditStrategySelection?.enabled) {
    const armIds = banditStrategySelection.armIds ?? DEFAULT_BANDIT_ARM_IDS;
    const strategySelectorLayer = StrategySelectorServiceLive(armIds, banditStore);
    combined = widen(Layer.merge(combined, strategySelectorLayer));
  }

  return combined;
};
