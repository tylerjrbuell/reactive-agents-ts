// File: src/runtime.ts
import { Layer } from "effect";
import type { ReasoningConfig } from "./types/config.js";
import { defaultReasoningConfig } from "./types/config.js";
import { StrategyRegistryLive } from "./services/strategy-registry.js";
import { ReasoningServiceLive } from "./services/reasoning-service.js";

/**
 * Create the full Reasoning layer (Phase 1: reactive only).
 *
 * Provides: ReasoningService, StrategyRegistry
 * Requires: LLMService (from Layer 1.5)
 *
 * Usage:
 *   const ReasoningLive = createReasoningLayer();
 *   const program = myEffect.pipe(Effect.provide(ReasoningLive));
 */
export const createReasoningLayer = (
  config: ReasoningConfig = defaultReasoningConfig,
) => {
  // StrategyRegistry has no deps (strategies are registered at construction)
  const RegistryLayer = StrategyRegistryLive;

  // ReasoningService needs StrategyRegistry
  const ServiceLayer = ReasoningServiceLive(config).pipe(
    Layer.provide(RegistryLayer),
  );

  // Merge all services into one layer
  return Layer.mergeAll(ServiceLayer, RegistryLayer);
};
