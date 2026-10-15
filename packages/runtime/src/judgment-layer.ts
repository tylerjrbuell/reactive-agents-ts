/**
 * Shared judgment-layer construction for `createRuntime` and `createLightRuntime`.
 *
 * Centralizes backend selection and layer wiring so both runtime tiers use the
 * same registry and cannot drift (Task 5, System One decision backends).
 */
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { Layer as LayerType } from "effect";
import {
  JudgmentService,
  makeJudgmentServiceLive,
  makeJevBackend,
  makeLlmBackend,
  makeOllamaBackend,
  withEvents,
} from "@reactive-agents/judgment";
import type { JudgmentBackend } from "@reactive-agents/judgment";
import { EventBus } from "@reactive-agents/core";
import {
  createJudgmentShadowSink,
  subscribeJudgmentShadowSink,
} from "@reactive-agents/eval";
import type { JudgmentBuilderOptions, JudgmentBackendName } from "./builder/types.js";

export type { JudgmentBackendName } from "./builder/types.js";

/**
 * Dependencies required by `buildJudgmentLayer` : supplied by the caller so
 * the helper stays pure and does not hard-wire layer construction details.
 */
export interface JudgmentLayerDeps {
  readonly llmLayer: LayerType.Layer<LLMService>;
  readonly eventBusLayer: LayerType.Layer<EventBus>;
}

/**
 * Wave 7.1 review fix: when set, `JudgmentShadow` bus events are recorded
 * into the sink at this SQLite path (the sink otherwise has no producer).
 * Only passed for auto-shadow activations — explicit `.withJudgment()` users
 * get the service without unsolicited disk writes (the subscriber helper is
 * exported for anyone who wants it).
 */
export interface JudgmentShadowOptions {
  readonly dbPath: string;
}

/**
 * Resolve the effective backend name from builder options and the environment.
 *
 * Preserves the exact precedence used by the legacy runtime.ts IIFEs:
 * explicit `backend` wins; otherwise `jev` when a TypeSafe key resolves (config
 * or `TYPESAFE_API_KEY`); otherwise `llm`.
 */
export const resolveBackendName = (jc: JudgmentBuilderOptions | undefined): JudgmentBackendName =>
  jc?.backend ?? (jc?.apiKey ?? process.env.TYPESAFE_API_KEY ? "jev" : "llm");

/**
 * Registry of backend constructors. Each entry is an effect that requires
 * `LLMService` (for the `llm` backend) and yields a `JudgmentBackend`.
 */
const BACKENDS = {
  jev: (jc: JudgmentBuilderOptions | undefined) =>
    Effect.succeed(
      makeJevBackend({
        apiKey: jc?.apiKey,
        baseUrl: jc?.baseUrl,
        model: jc?.model,
        timeoutMs: jc?.timeoutMs,
        defaultConfidenceFloor: jc?.defaultConfidenceFloor,
      }),
    ),
  llm: (_jc: JudgmentBuilderOptions | undefined) =>
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return makeLlmBackend(llm);
    }),
  ollama: (jc: JudgmentBuilderOptions | undefined) =>
    Effect.succeed(
      makeOllamaBackend({
        baseUrl: jc?.baseUrl,
        model: jc?.model,
        timeoutMs: jc?.timeoutMs,
        keepAlive: jc?.ollama?.keepAlive,
      }),
    ),
} satisfies Record<JudgmentBackendName, (jc: JudgmentBuilderOptions | undefined) => Effect.Effect<JudgmentBackend, never, LLMService>>;

/**
 * Build the optional `JudgmentService` layer for a runtime.
 *
 * The caller still decides whether judgment is enabled at all; this helper
 * composes the backend registry, service live layer, and event wrapping in a
 * single shared path used by both `createRuntime` and `createLightRuntime`.
 */
export const buildJudgmentLayer = (
  jc: JudgmentBuilderOptions | undefined,
  deps: JudgmentLayerDeps,
  shadow?: JudgmentShadowOptions,
): Layer.Layer<JudgmentService, never, never> => {
  const backendName = resolveBackendName(jc);
  const serviceLayer: Layer.Layer<JudgmentService, never, never> = Layer.unwrapEffect(
    Effect.map(BACKENDS[backendName](jc), makeJudgmentServiceLive),
  ).pipe(Layer.provide(deps.llmLayer));

  const withEventsLayer = withEvents("agent.judge", backendName).pipe(
    Layer.provide(Layer.merge(serviceLayer, deps.eventBusLayer)),
  );

  if (shadow === undefined) return withEventsLayer;

  // Shadow subscription: tag-filtered bus → sink, released with the layer.
  // Best-effort by sink design (a full disk must never break a run).
  const sinkLayer: Layer.Layer<never, never, never> = Layer.scopedDiscard(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const unsub = yield* subscribeJudgmentShadowSink(bus, createJudgmentShadowSink(shadow.dbPath));
      yield* Effect.addFinalizer(() => Effect.sync(unsub));
    }),
  ).pipe(Layer.provide(deps.eventBusLayer));

  return Layer.merge(withEventsLayer, sinkLayer);
};
