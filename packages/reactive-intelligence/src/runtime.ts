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
import { makeSkillResolverService } from "./skills/skill-resolver.js";
import type { SkillResolverConfig } from "./skills/skill-resolver.js";
import { makeSkillDistillerService } from "./skills/skill-distiller.js";
import type { SkillDistillerDeps } from "./skills/skill-distiller.js";

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

  return combined;
};
