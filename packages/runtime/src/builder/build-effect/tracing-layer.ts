/**
 * Conditional Tracing/TraceRecorder layer composition.
 *
 * When .withTracing() is enabled (or default-enabled), dynamic-imports
 * TraceRecorderServiceLive + TraceBridgeLayer from @reactive-agents/trace,
 * composes the recorder + bridge, and merges them into the runtime.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Layer } from "effect";

export interface TracingLayerDeps {
  readonly tracingConfig: { readonly dir: string } | null;
}

/**
 * Conditionally merge tracing recorder + bridge layers into `baseRuntime`.
 *
 * Returns `baseRuntime` unchanged when `tracingConfig === null`. Otherwise
 * dynamic-imports `@reactive-agents/trace` and composes the recorder and
 * bridge layers atop the input runtime.
 */
export const composeTracingLayer = (
  baseRuntime: Layer.Layer<unknown, unknown, unknown>,
  deps: TracingLayerDeps,
): Effect.Effect<Layer.Layer<unknown, unknown, unknown>, never> =>
  Effect.gen(function* () {
    if (deps.tracingConfig === null) {
      return baseRuntime;
    }
    const { TraceRecorderServiceLive, TraceBridgeLayer } = yield* Effect.promise(
      () => import("@reactive-agents/trace"),
    );
    const recorderLayer = TraceRecorderServiceLive({
      dir: deps.tracingConfig.dir,
    });
    const bridgeLayer = TraceBridgeLayer.pipe(
      Layer.provide(recorderLayer),
      Layer.provide(baseRuntime),
    );
    return Layer.merge(
      Layer.merge(baseRuntime, recorderLayer),
      bridgeLayer,
    );
  });
