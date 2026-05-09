/**
 * Conditional Health service layer composition.
 *
 * When .withHealthCheck() is enabled, wraps the runtime with a
 * Layer.effect(Health, makeHealthService(...)) layer. Returns the
 * input layer unchanged when the feature is off.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Layer } from "effect";
import { Health, makeHealthService } from "@reactive-agents/health";

export interface HealthLayerDeps {
  readonly enableHealthCheck: boolean;
  readonly agentName: string;
}

/**
 * Conditionally merge the Health service layer into `baseRuntime`.
 *
 * Returns `baseRuntime` unchanged when `enableHealthCheck` is false.
 */
export const composeHealthLayer = (
  baseRuntime: Layer.Layer<unknown>,
  deps: HealthLayerDeps,
): Layer.Layer<unknown> => {
  if (!deps.enableHealthCheck) {
    return baseRuntime;
  }
  const healthServiceLayer = Layer.effect(
    Health,
    makeHealthService({ port: 0, agentName: deps.agentName }),
  ).pipe(Layer.provide(baseRuntime as unknown as Layer.Layer<any>));

  return Layer.merge(
    baseRuntime as unknown as Layer.Layer<any>,
    healthServiceLayer,
  ) as unknown as Layer.Layer<unknown>;
};
