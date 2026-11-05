import { Layer, Effect, Context } from "effect";
import { createLLMProviderLayer, LLMService } from "@reactive-agents/llm-provider";
import { cascadeWithTransitions } from "./llm-fallback-cascade.js";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Build effectiveLlmLayer: if fallbackConfig has additional providers, wrap
 * the primary layer with Effect.catchAll chains so failures cascade through
 * fallback providers automatically. Extracted verbatim from `createRuntime`
 * (GH #267).
 */
export function buildEffectiveLlmLayer(
  options: RuntimeOptions,
  llmLayer: Layer.Layer<LLMService>,
): Layer.Layer<LLMService> {
  const fallbackProviders = (options.fallbackConfig?.providers ?? []).slice(1);
  const effectiveLlmLayer: Layer.Layer<LLMService> =
    fallbackProviders.length > 0
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const primary = yield* LLMService.pipe(
              Effect.provide(llmLayer as Layer.Layer<LLMService, never, never>),
            );
            const fallbacks = yield* Effect.all(
              // Deliberately NOT threading options.providerConfig here — a
              // fallback is a different provider/endpoint by definition, so
              // inheriting the primary's baseUrl/apiKey override would be
              // wrong (see RuntimeOptions.providerConfig JSDoc).
              fallbackProviders.map((fp) =>
                LLMService.pipe(
                  Effect.provide(
                    createLLMProviderLayer(fp as Parameters<typeof createLLMProviderLayer>[0], undefined, undefined, {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        numCtx: options.numCtx,
                      }) as Layer.Layer<LLMService, never, never>,
                  ),
                ),
              ),
              { concurrency: "unbounded" },
            );
            const all = [primary, ...fallbacks];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return {
              complete: (req: Parameters<typeof primary.complete>[0]) =>
                // Honest provider cascade: try the primary, and on ANY error fall
                // through to the next configured provider in order. Each real
                // switch attaches a transition (consumed by inline-think.ts /
                // verification-think-retry.ts to emit ProviderFallbackActivated).
                // No consecutive-error threshold and no per-model chain — those
                // knobs were removed (P0-3) because they were never wired.
                cascadeWithTransitions(
                  [options.provider ?? "test", ...fallbackProviders],
                  primary.complete(req),
                  fallbacks.map((fb) => fb.complete(req)),
                ),
              stream: (req: Parameters<typeof primary.stream>[0]) => primary.stream(req),
              completeStructured: (req: Parameters<typeof primary.completeStructured>[0]) => {
                let effect: ReturnType<typeof primary.completeStructured> =
                  primary.completeStructured(req);
                for (const fb of fallbacks) {
                  const captured = fb;
                  effect = effect.pipe(Effect.catchAll(() => captured.completeStructured(req)));
                }
                return effect;
              },
              embed: (texts: Parameters<typeof primary.embed>[0], model: Parameters<typeof primary.embed>[1]) => {
                let effect = primary.embed(texts, model);
                for (const fb of all.slice(1)) {
                  const captured = fb;
                  effect = effect.pipe(Effect.catchAll(() => captured.embed(texts, model)));
                }
                return effect;
              },
              countTokens: (msgs: Parameters<typeof primary.countTokens>[0]) => primary.countTokens(msgs),
              getModelConfig: () => primary.getModelConfig(),
              getStructuredOutputCapabilities: () => primary.getStructuredOutputCapabilities(),
            } as Context.Tag.Service<LLMService>;
          }),
        )
      : (llmLayer as Layer.Layer<LLMService>);
  return effectiveLlmLayer;
}
