import type { ReactiveIntelligenceConfig } from "./types.js";
import { defaultReactiveIntelligenceConfig } from "./types.js";
import { EntropySensorServiceLive } from "./sensor/entropy-sensor-service.js";

export const createReactiveIntelligenceLayer = (
  config?: Partial<ReactiveIntelligenceConfig>,
) => {
  const merged = { ...defaultReactiveIntelligenceConfig, ...config };
  return EntropySensorServiceLive(merged);
};
