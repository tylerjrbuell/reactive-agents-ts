import { Layer } from "effect";
import type { ReactiveIntelligenceConfig } from "./types.js";
import { defaultReactiveIntelligenceConfig } from "./types.js";
import { EntropySensorServiceLive } from "./sensor/entropy-sensor-service.js";
import { ReactiveControllerService, ReactiveControllerServiceLive } from "./controller/controller-service.js";
import { CalibrationStore } from "./calibration/calibration-store.js";
import { BanditStore } from "./learning/bandit-store.js";
import { LearningEngineServiceLive } from "./learning/learning-engine.js";
import type { SkillStore } from "./learning/learning-engine.js";

export const createReactiveIntelligenceLayer = (
  config?: Partial<ReactiveIntelligenceConfig>,
  skillStore?: SkillStore,
) => {
  const merged = { ...defaultReactiveIntelligenceConfig, ...config };

  // Shared calibration store — used by both sensor and learning engine
  const calStore = new CalibrationStore();
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
    combined = Layer.merge(combined, controllerLayer) as any;
  }

  return combined;
};
