import { Layer } from "effect";
import type { ReactiveIntelligenceConfig } from "./types.js";
import { defaultReactiveIntelligenceConfig } from "./types.js";
import { EntropySensorServiceLive } from "./sensor/entropy-sensor-service.js";
import { ReactiveControllerService, ReactiveControllerServiceLive } from "./controller/controller-service.js";

export const createReactiveIntelligenceLayer = (
  config?: Partial<ReactiveIntelligenceConfig>,
) => {
  const merged = { ...defaultReactiveIntelligenceConfig, ...config };
  const entropyLayer = EntropySensorServiceLive(merged);

  // Compose controller layer when any controller feature is enabled
  const ctrl = merged.controller;
  const controllerEnabled = ctrl?.earlyStop || ctrl?.contextCompression || ctrl?.strategySwitch;
  if (controllerEnabled) {
    const controllerLayer = ReactiveControllerServiceLive({
      earlyStop: ctrl?.earlyStop ?? false,
      contextCompression: ctrl?.contextCompression ?? false,
      strategySwitch: ctrl?.strategySwitch ?? false,
    });
    return Layer.merge(entropyLayer, controllerLayer);
  }

  return entropyLayer;
};
