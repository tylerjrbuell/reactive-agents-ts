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
  let combined = Layer.merge(entropyLayer, learningLayer);

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
    combined = Layer.merge(combined, controllerLayer) as any;
    combined = Layer.merge(combined, dispatcherLayer) as any;
  }

  // Skill Resolver (optional)
  if (skillConfig?.resolver) {
    const resolverLayer = makeSkillResolverService(skillConfig.resolver);
    combined = Layer.merge(combined, resolverLayer) as any;
  }

  // Skill Distiller (optional)
  if (skillConfig?.distiller) {
    const distillerLayer = makeSkillDistillerService(
      skillConfig.distiller,
      skillConfig.distillerConfig ? { refinementThreshold: skillConfig.distillerConfig.refinementThreshold ?? 5 } : undefined,
    );
    combined = Layer.merge(combined, distillerLayer) as any;
  }

  return combined;
};
